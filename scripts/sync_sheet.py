#!/usr/bin/env python3
"""
sync_sheet.py - Google 시트 데이터를 JSON 파일로 자동 변환

[동작 방식]
1. Google Sheets API로 시트의 모든 탭을 가져옴
2. 각 탭의 헤더를 보고 데이터 타입 자동 감지 (새/물고기/곤충/요리/작물/채집/상점)
3. 시즌 컬럼 기준으로 파일 분기:
   - "일반"     → src/data/{type}.json
   - "꿈의 명암" → src/data/season_dreamlight/season_dreamlight_{type}.json
   - "빙설"     → src/data/season_ice/season_ice_{type}.json
4. 변경된 JSON만 덮어씀

[사용법]
  GOOGLE_API_KEY=xxx python3 scripts/sync_sheet.py

[GitHub Actions 환경에서는 GOOGLE_API_KEY secret을 환경변수로 주입]
"""

import os
import json
import sys
import requests
from pathlib import Path

# ─── 설정 ─────────────────────────────────────────────────────────────────────

SHEET_ID = "1SPVNX6URAl5klHUil5O8qd49lH2LezRiBqDFBimgnGM"
API_KEY  = os.environ.get("GOOGLE_API_KEY", "")

BASE_URL = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"

# 스크립트 위치 기준으로 레포 루트 찾기
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT  = SCRIPT_DIR.parent
DATA_DIR   = REPO_ROOT / "src" / "data"

# 시즌 → 출력 폴더/파일명 접두사 매핑
SEASON_MAP = {
    "꿈의 명암": ("season_dreamlight", DATA_DIR / "season_dreamlight"),
    "빙설":      ("season_ice",        DATA_DIR / "season_ice"),
    "블록 시가지": ("season_blocktown",  DATA_DIR / "season_blocktown"),
}

# 데이터 타입 → 기본 파일명 (확장자 제외)
TYPE_FILENAME = {
    "bird":    "bird_data",
    "fish":    "fish_data",
    "insect":  "insect_data",
    "recipes": "recipes",
    "crops":   "crops",
    "gather":  "gather",
    "shop":    "shop",
}

# ─── API 호출 ──────────────────────────────────────────────────────────────────

def fetch_spreadsheet_meta():
    """시트 메타데이터(탭 목록) 조회"""
    url = f"{BASE_URL}?key={API_KEY}&fields=sheets.properties"
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    return res.json()["sheets"]


def fetch_sheet_values(sheet_title: str) -> list[list[str]]:
    """특정 탭의 모든 셀 값 조회 (2D 배열)"""
    encoded_title = requests.utils.quote(f"'{sheet_title}'")
    url = f"{BASE_URL}/values/{encoded_title}?key={API_KEY}"
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    return res.json().get("values", [])


# ─── 공통 파싱 유틸 ────────────────────────────────────────────────────────────

def to_int(val: str):
    """문자열 → 정수, 변환 불가 시 None"""
    try:
        return int(str(val).strip()) if val and str(val).strip() else None
    except ValueError:
        return None


def to_float(val: str):
    """문자열 → 실수, 변환 불가 시 None"""
    try:
        return float(str(val).strip()) if val and str(val).strip() else None
    except ValueError:
        return None


def parse_list(val: str) -> list[str]:
    """'아침, 낮, 저녁' → ['아침', '낮', '저녁']"""
    if not val or not str(val).strip():
        return []
    return [v.strip() for v in str(val).split(",") if v.strip()]


def parse_motion(val: str):
    """
    모션 조건 파싱
    - '아침: 맑음, 비 / 낮: 맑음, 비' → {'아침': ['맑음', '비'], '낮': ['맑음', '비']}
    - '항상'                           → '항상' (특수값 그대로 유지)
    - 빈 값                            → {} (빈 딕셔너리 → 최종 JSON에서 키 제거됨)
    """
    val = str(val).strip() if val else ""
    if not val:
        return {}
    if val == "항상":
        return "항상"

    result = {}
    # '/' 기준으로 시간대별 조건 분리 ("아침: 맑음, 비 / 낮: 맑음, 비")
    for part in val.split("/"):
        part = part.strip()
        if ":" not in part:
            continue
        time_key, weather_str = part.split(":", 1)
        time_key = time_key.strip()
        weathers = [w.strip() for w in weather_str.split(",") if w.strip()]
        if time_key and weathers:
            result[time_key] = weathers
    return result


def split_tables(rows: list[list[str]]) -> list[list[list[str]]]:
    """
    한 탭 안에 빈 행으로 구분된 여러 테이블이 있을 경우 분리.
    반환값: [[테이블1_rows], [테이블2_rows], ...]
    """
    tables = []
    current: list[list[str]] = []

    for row in rows:
        # 행의 모든 셀이 비어있으면 구분자
        if not any(cell.strip() for cell in row):
            if current:
                tables.append(current)
                current = []
        else:
            current.append(row)

    if current:
        tables.append(current)
    return tables


def rows_to_dicts(table: list[list[str]]) -> tuple[list[str], list[dict]]:
    """
    2D 배열 → (헤더 리스트, 딕셔너리 리스트).
    첫 번째 행이 헤더, 첫 번째 컬럼이 비어 있는 행은 데이터 없음으로 간주해 스킵.
    """
    if not table:
        return [], []
    headers = table[0]
    result = []
    for row in table[1:]:
        if not row or not str(row[0]).strip():
            continue
        # 헤더보다 짧으면 빈 문자열로 패딩
        padded = row + [""] * max(0, len(headers) - len(row))
        result.append(dict(zip(headers, padded)))
    return headers, result


def save_json(path: Path, data):
    """JSON 파일 저장 (디렉토리 자동 생성, 이미 같으면 스킵)"""
    path.parent.mkdir(parents=True, exist_ok=True)

    # 기존 파일과 다를 때만 덮어씀 (불필요한 git diff 방지)
    new_content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if path.exists():
        if path.read_text(encoding="utf-8") == new_content:
            print(f"  변경 없음 스킵: {path.relative_to(REPO_ROOT)}")
            return

    path.write_text(new_content, encoding="utf-8")
    print(f"  저장됨: {path.relative_to(REPO_ROOT)}")


# ─── 탭 타입 자동 감지 ─────────────────────────────────────────────────────────

def detect_type(headers: list[str]) -> str | None:
    """
    헤더 컬럼 이름을 보고 탭 타입 결정.
    각 타입은 고유한 컬럼으로 구분.
    """
    h = set(headers)
    if "깃털 다듬기 조건" in h:       return "bird"
    if "씨앗 가격" in h:              return "crops"
    if "재료1" in h:                  return "recipes"
    if "일일 한도" in h:              return "shop"
    if "숨김" in h:                   return "gather"
    if "크기" in h and "시간대" in h: return "fish"
    if "시간대" in h and "서식지" in h: return "insect"
    return None


# ─── 등급 배수 파싱 ────────────────────────────────────────────────────────────

def parse_grade_multipliers(table: list[list[str]]) -> dict:
    """
    등급 배수 테이블 파싱.
    | 등급   | 판매 배수 | (체력 배수) |
    | 1등급  | 1         | 1.0        |
    → {"1": 1.0, "2": 1.33, ...}
    """
    if not table or len(table) < 2:
        return {}

    headers = table[0]
    result = {}

    # 등급 번호 추출 (1등급 → "1", 2 → "2" 등)
    for row in table[1:]:
        if not row:
            continue
        grade_raw = str(row[0]).strip()
        if not grade_raw:
            continue
        # "1등급" → "1", 그냥 "1" → "1"
        grade_num = grade_raw.replace("등급", "").strip()
        if not grade_num.isdigit():
            continue

        # 판매 배수 (두 번째 컬럼)
        sell_mult = to_float(row[1] if len(row) > 1 else "")
        if sell_mult is not None:
            result[grade_num] = sell_mult

    return result


def parse_stamina_multipliers(table: list[list[str]]) -> dict:
    """
    체력 배수 테이블 파싱 (요리 전용).
    | 등급 | 판매 배수 | 체력 배수 |
    → {"1": 1.0, "2": 1.2, ...}
    """
    if not table or len(table) < 2:
        return {}

    result = {}
    for row in table[1:]:
        if not row:
            continue
        grade_raw = str(row[0]).strip().replace("등급", "").strip()
        if not grade_raw.isdigit():
            continue
        # 체력 배수는 세 번째 컬럼
        stam_mult = to_float(row[2] if len(row) > 2 else "")
        if stam_mult is not None:
            result[grade_raw] = stam_mult

    return result


# ─── 새 탭 처리 ────────────────────────────────────────────────────────────────

def handle_bird(tables: list[list[list[str]]]):
    """
    새 탭 파싱.
    첫 번째 테이블: 새 데이터
    두 번째 테이블: 등급 배수 (현재 bird_data.json에는 없으므로 무시)
    """
    if not tables:
        return

    # 첫 번째 테이블 = 새 데이터
    _, dicts = rows_to_dicts(tables[0])

    regular = []          # 시즌 "일반"
    seasons: dict = {}    # 시즌명 → 아이템 리스트

    for d in dicts:
        season = d.get("시즌", "").strip()

        item: dict = {
            "name":     d.get("이름", "").strip(),
            "level":    to_int(d.get("레벨", "")),
            "habitat":  d.get("서식지", "").strip(),
            "time":     parse_list(d.get("시간대", "")),
            "weather":  parse_list(d.get("날씨", "")),
            "price":    to_int(d.get("판매가", "")),
            # "일반" → false, 그 외 → 시즌명 문자열
            "special":  False if season == "일반" else season,
            "category": d.get("카테고리", "").strip(),
        }

        # 모션 조건 (비어있으면 키 자체를 추가하지 않음)
        preening   = parse_motion(d.get("깃털 다듬기 조건", ""))
        wingspread = parse_motion(d.get("날개 펴기 조건", ""))
        if preening:
            item["motion_preening"]   = preening
        if wingspread:
            item["motion_wingspread"] = wingspread

        # 이미지 ID (숫자)
        img = to_int(d.get("이미지ID", ""))
        if img is not None:
            item["image"] = img

        # 시즌 분기
        if season == "일반":
            regular.append(item)
        else:
            seasons.setdefault(season, []).append(item)

    # 저장
    save_json(DATA_DIR / "bird_data.json", regular)
    for season_name, items in seasons.items():
        if season_name in SEASON_MAP:
            prefix, folder = SEASON_MAP[season_name]
            save_json(folder / f"{prefix}_bird.json", items)


# ─── 물고기 탭 처리 ────────────────────────────────────────────────────────────

def handle_fish(tables: list[list[list[str]]]):
    """물고기 탭 파싱"""
    if not tables:
        return

    _, dicts = rows_to_dicts(tables[0])

    regular = []
    seasons: dict = {}

    for d in dicts:
        season = d.get("시즌", "").strip()

        item: dict = {
            "name":    d.get("이름", "").strip(),
            "level":   to_int(d.get("레벨", "")),
            "habitat": d.get("서식지", "").strip(),
            "size":    d.get("크기", "").strip(),
            "time":    parse_list(d.get("시간대", "")),
            "weather": parse_list(d.get("날씨", "")),
            "price":   to_int(d.get("판매가", "")),
            "special": False if season == "일반" else season,
        }

        img = to_int(d.get("이미지ID", ""))
        if img is not None:
            item["image"] = img

        # 먹이 가능 여부 (FALSE/TRUE 문자열)
        feedable = d.get("먹이 가능", "").strip()
        if feedable:
            item["feedable"] = feedable.upper() != "FALSE"

        if season == "일반":
            regular.append(item)
        else:
            seasons.setdefault(season, []).append(item)

    save_json(DATA_DIR / "fish_data.json", regular)
    for season_name, items in seasons.items():
        if season_name in SEASON_MAP:
            prefix, folder = SEASON_MAP[season_name]
            save_json(folder / f"{prefix}_fish.json", items)


# ─── 곤충 탭 처리 ─────────────────────────────────────────────────────────────

def handle_insect(tables: list[list[list[str]]]):
    """곤충 탭 파싱"""
    if not tables:
        return

    _, dicts = rows_to_dicts(tables[0])

    regular = []
    seasons: dict = {}

    for d in dicts:
        season = d.get("시즌", "").strip()

        item: dict = {
            "name":    d.get("이름", "").strip(),
            "level":   to_int(d.get("레벨", "")),
            "habitat": d.get("서식지", "").strip(),
            "time":    parse_list(d.get("시간대", "")),
            "weather": parse_list(d.get("날씨", "")),
            "price":   to_int(d.get("판매가", "")),
            "special": False if season == "일반" else season,
        }

        img = to_int(d.get("이미지ID", ""))
        if img is not None:
            item["image"] = img

        if season == "일반":
            regular.append(item)
        else:
            seasons.setdefault(season, []).append(item)

    save_json(DATA_DIR / "insect_data.json", regular)
    for season_name, items in seasons.items():
        if season_name in SEASON_MAP:
            prefix, folder = SEASON_MAP[season_name]
            save_json(folder / f"{prefix}_insect.json", items)


# ─── 요리 탭 처리 ─────────────────────────────────────────────────────────────

def handle_recipes(tables: list[list[list[str]]]):
    """
    요리 탭 파싱.
    - 첫 번째 테이블: 요리 목록
    - 이후 테이블 중 '등급/판매 배수/체력 배수' 형식 → gradeMultipliers + staminaMultipliers
    """
    if not tables:
        return

    _, dicts = rows_to_dicts(tables[0])

    # 등급/체력 배수 테이블 찾기
    grade_mult   = {}
    stamina_mult = {}
    for table in tables[1:]:
        if not table or not table[0]:
            continue
        headers = table[0]
        if "등급" in headers and "판매 배수" in headers and "체력 배수" in headers:
            # 판매 + 체력 배수 동시 파싱
            for row in table[1:]:
                if not row:
                    continue
                grade_raw = str(row[0]).strip().replace("등급", "").strip()
                if not grade_raw.isdigit():
                    continue
                sell_idx   = headers.index("판매 배수")   if "판매 배수"  in headers else 1
                stam_idx   = headers.index("체력 배수")   if "체력 배수"  in headers else 2
                sell = to_float(row[sell_idx] if len(row) > sell_idx else "")
                stam = to_float(row[stam_idx] if len(row) > stam_idx else "")
                if sell is not None:
                    grade_mult[grade_raw]   = sell
                if stam is not None:
                    stamina_mult[grade_raw] = stam
        elif "등급" in headers and "판매 배수" in headers:
            grade_mult = parse_grade_multipliers(table)

    # 요리 아이템 파싱
    regular = []
    seasons: dict = {}

    for d in dicts:
        season = d.get("시즌", "").strip()

        # 재료 목록 (빈 재료 제거)
        ingredients = [
            d.get("재료1", "").strip(),
            d.get("재료2", "").strip(),
            d.get("재료3", "").strip(),
            d.get("재료4", "").strip(),
        ]
        ingredients = [ing for ing in ingredients if ing]

        item: dict = {
            "name":        d.get("이름", "").strip(),
            "sellPrice":   to_int(d.get("판매가 (1등급)", "")),
            "stamina":     to_int(d.get("체력 (1등급)", "")),
            "ingredients": ingredients,
            "image":       d.get("이미지", "").strip(),
            "season":      season,
        }

        # 선택 필드
        uses = to_int(d.get("섭취 횟수", ""))
        if uses:
            item["uses"] = uses

        buff = d.get("버프", "").strip()
        if buff:
            item["buff"] = buff

        feedable = d.get("먹이 가능", "").strip()
        if feedable:
            item["feedable"] = feedable.upper() != "FALSE"

        if season == "일반":
            regular.append(item)
        else:
            seasons.setdefault(season, []).append(item)

    # recipes.json은 딕셔너리 형식 (gradeMultipliers + staminaMultipliers + items)
    recipes_data: dict = {}
    if grade_mult:
        recipes_data["gradeMultipliers"]   = grade_mult
    if stamina_mult:
        recipes_data["staminaMultipliers"] = stamina_mult
    recipes_data["items"] = regular

    save_json(DATA_DIR / "recipes.json", recipes_data)

    for season_name, items in seasons.items():
        if season_name in SEASON_MAP:
            prefix, folder = SEASON_MAP[season_name]
            season_data = {"items": items}
            if grade_mult:
                season_data["gradeMultipliers"] = grade_mult
            if stamina_mult:
                season_data["staminaMultipliers"] = stamina_mult
            save_json(folder / f"{prefix}_recipes.json", season_data)


# ─── 작물 탭 처리 ─────────────────────────────────────────────────────────────

def handle_crops(tables: list[list[list[str]]]):
    """
    작물 탭 파싱.
    crops.json 형식: {"gradeMultipliers": {...}, "items": [...]}
    """
    if not tables:
        return

    _, dicts = rows_to_dicts(tables[0])

    # 등급 배수 테이블 찾기
    grade_mult = {}
    for table in tables[1:]:
        if table and table[0] and "등급" in table[0]:
            grade_mult = parse_grade_multipliers(table)
            break

    regular = []
    seasons: dict = {}

    for d in dicts:
        season = d.get("시즌", "").strip()

        item: dict = {
            "name":           d.get("이름", "").strip(),
            "seedPrice":      to_int(d.get("씨앗 가격", "")),
            "harvestMinutes": to_int(d.get("수확 시간 (분)", "")),
            "sellPrice":      to_int(d.get("판매가 (1등급)", "")),
            "image":          d.get("이미지", "").strip(),
        }

        if season == "일반":
            regular.append(item)
        else:
            seasons.setdefault(season, []).append(item)

    crops_data: dict = {}
    if grade_mult:
        crops_data["gradeMultipliers"] = grade_mult
    crops_data["items"] = regular

    save_json(DATA_DIR / "crops.json", crops_data)

    for season_name, items in seasons.items():
        if season_name in SEASON_MAP:
            prefix, folder = SEASON_MAP[season_name]
            season_data = {}
            if grade_mult:
                season_data["gradeMultipliers"] = grade_mult
            season_data["items"] = items
            save_json(folder / f"{prefix}_crops.json", season_data)


# ─── 채집 탭 처리 ─────────────────────────────────────────────────────────────

def handle_gather(tables: list[list[list[str]]]):
    """채집 아이템 탭 파싱"""
    if not tables:
        return

    _, dicts = rows_to_dicts(tables[0])
    items = []

    for d in dicts:
        item: dict = {
            "name":      d.get("이름", "").strip(),
            "sellPrice": to_int(d.get("판매가", "")),
        }

        image = d.get("이미지", "").strip()
        if image:
            item["image"] = image

        # 숨김 여부 (TRUE이면 hidden: true 추가)
        hidden = d.get("숨김", "").strip()
        if hidden.upper() == "TRUE":
            item["hidden"] = True

        items.append(item)

    save_json(DATA_DIR / "gather.json", items)


# ─── 상점 탭 처리 ─────────────────────────────────────────────────────────────

def handle_shop(tables: list[list[list[str]]]):
    """상점 탭 파싱"""
    if not tables:
        return

    _, dicts = rows_to_dicts(tables[0])
    items = []

    for d in dicts:
        item: dict = {
            "name":         d.get("이름", "").strip(),
            "shopPrice":    to_int(d.get("구매가", "")),
            "dailyLimit":   to_int(d.get("일일 한도", "")),
            "availability": d.get("구매 가능 시즌", "").strip(),
        }
        items.append(item)

    save_json(DATA_DIR / "shop.json", items)


# ─── 메인 ─────────────────────────────────────────────────────────────────────

# 탭 타입 → 핸들러 함수 매핑
HANDLERS = {
    "bird":    handle_bird,
    "fish":    handle_fish,
    "insect":  handle_insect,
    "recipes": handle_recipes,
    "crops":   handle_crops,
    "gather":  handle_gather,
    "shop":    handle_shop,
}


def main():
    if not API_KEY:
        print("❌ 오류: GOOGLE_API_KEY 환경변수가 설정되지 않았습니다.")
        print("   export GOOGLE_API_KEY=your_api_key_here")
        sys.exit(1)

    print("📊 Google 시트 동기화 시작...")
    print(f"   시트 ID: {SHEET_ID}")

    # 모든 탭 목록 조회
    try:
        sheets_meta = fetch_spreadsheet_meta()
    except requests.HTTPError as e:
        print(f"❌ 시트 메타데이터 조회 실패: {e}")
        sys.exit(1)

    print(f"   탭 {len(sheets_meta)}개 발견: {[s['properties']['title'] for s in sheets_meta]}\n")

    processed = 0
    for sheet in sheets_meta:
        title = sheet["properties"]["title"]
        print(f"[{title}] 처리 중...")

        # 탭 데이터 조회
        try:
            rows = fetch_sheet_values(title)
        except requests.HTTPError as e:
            print(f"  ⚠️  데이터 조회 실패: {e}")
            continue

        if not rows:
            print("  데이터 없음, 스킵")
            continue

        # 탭 타입 감지 (첫 번째 행 헤더 기준)
        tab_type = detect_type(rows[0])
        if not tab_type:
            print(f"  알 수 없는 형식 (헤더: {rows[0][:4]}), 스킵")
            continue

        print(f"  → 타입: {tab_type}")

        # 빈 행 기준으로 내부 테이블 분리 후 핸들러 호출
        tables = split_tables(rows)
        HANDLERS[tab_type](tables)
        processed += 1

    print(f"\n✅ 완료! ({processed}/{len(sheets_meta)} 탭 처리됨)")


if __name__ == "__main__":
    main()
