"""
csv_to_json.py
==============
heartopia 프로젝트의 CSV 데이터를 JSON 포맷으로 변환하는 범용 스크립트.

[폴더 구조]
heartopia/
├── src/data/
│   ├── fish_data.json               ← 일반 물고기
│   ├── insect_data.json             ← 일반 곤충
│   ├── bird_data.json               ← 일반 새
│   ├── recipes.json                 ← 일반 레시피
│   ├── crops.json                   ← 일반 작물
│   ├── shop.json                    ← 상점 (시즌 availability 필드로 구분)
│   ├── gather.json                  ← 채집 아이템
│   ├── season_ice/                  ← 빙설 시즌 전용 파일
│   │   ├── season_ice_fish.json
│   │   ├── season_ice_insect.json
│   │   ├── season_ice_bird.json
│   │   ├── season_ice_recipes.json
│   │   └── season_ice_crops.json
│   └── season_dreamlight/           ← 꿈의 명암 시즌 전용 파일
│       ├── season_dreamlight_fish.json
│       ├── season_dreamlight_insect.json
│       ├── season_dreamlight_recipes.json
│       └── season_dreamlight_crops.json
└── tools/
    ├── csv/                         ← 원본 CSV 파일을 여기에 넣으면 됨
    │   ├── 물고기.csv
    │   ├── 곤충.csv
    │   ├── 새.csv
    │   ├── 레시피.csv
    │   ├── 작물.csv
    │   ├── 상점.csv
    │   └── 채집.csv
    └── csv_to_json.py               ← 이 파일

[시즌 분류 규칙]
  - 시즌 컬럼 = "일반"   → 메인 데이터 파일에 포함
  - 시즌 컬럼 = "빙설"   → season_ice/ 파일에 저장
  - 시즌 컬럼 = "꿈의 명암" → season_dreamlight/ 파일에 저장
  - 상점(shop)은 시즌 분리 없이 availability 필드로 구분

[사용법]
  # 모든 타입 일괄 변환
  python tools/csv_to_json.py

  # 특정 타입만 변환
  python tools/csv_to_json.py fish
  python tools/csv_to_json.py gather
  python tools/csv_to_json.py recipe
  python tools/csv_to_json.py insect bird
  python tools/csv_to_json.py fish insect bird recipe crops shop gather

[새 타입 추가 방법]
  1. convert_*_row() 함수 작성
  2. CONVERTERS 딕셔너리에 항목 추가
     - 시즌 분리 필요한 타입: main_output / ice_output / dreamlight_output 모두 지정
     - 시즌 분리 불필요: main_output 만 지정, custom_fn 으로 단순 저장 함수 사용
     - 래퍼 객체 출력(레시피·작물): custom_fn 에 전용 변환 함수 지정
  3. tools/csv/ 폴더에 CSV 파일 배치
"""

import csv
import json
import sys
from pathlib import Path
from typing import Any

# ─────────────────────────────────────────────────────────
# 경로 설정
# ─────────────────────────────────────────────────────────

# 스크립트 위치(tools/)의 상위 = 프로젝트 루트
TOOLS_DIR    = Path(__file__).parent           # tools/
PROJECT_ROOT = TOOLS_DIR.parent                # heartopia/
CSV_DIR      = TOOLS_DIR / "csv"               # tools/csv/
DATA_DIR     = PROJECT_ROOT / "src" / "data"   # src/data/


# ─────────────────────────────────────────────────────────
# 시즌 분류 상수
# 새로운 시즌이 추가되면 여기에 값 집합을 추가하고,
# CONVERTERS 에 season_*_output 경로를 지정하면 됩니다.
# ─────────────────────────────────────────────────────────

SEASON_ICE_VALUES        = {"빙설"}           # 빙설 시즌 식별 값
SEASON_DREAMLIGHT_VALUES = {"꿈의 명암"}       # 꿈의 명암 시즌 식별 값


# ─────────────────────────────────────────────────────────
# 공통 파싱 유틸리티
# ─────────────────────────────────────────────────────────

def parse_list_field(value: str) -> list[str]:
    """
    쉼표로 구분된 문자열을 리스트로 변환.
    예: "아침, 낮, 저녁" → ["아침", "낮", "저녁"]
    """
    if not value or not value.strip():
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_special(value: str) -> bool | str:
    """
    시즌 컬럼 값을 JSON의 special 필드로 변환.
    - "일반" 또는 빈 값 → False  (JSON에서 일반 아이템 표시용)
    - 그 외 ("빙설", "꿈의 명암", "희귀" 등) → 문자열 그대로
    """
    stripped = (value or "").strip()
    if not stripped or stripped == "일반":
        return False
    return stripped


def parse_int(value: str) -> int | None:
    """
    문자열을 정수로 변환. 비어 있거나 변환 불가 시 None 반환.
    """
    if not value or not str(value).strip():
        return None
    try:
        return int(float(str(value).strip()))  # "10.0" → 10 처리 포함
    except (ValueError, TypeError):
        return None


def parse_number(value: str) -> int | float | None:
    """
    문자열을 숫자로 변환.
    - 소수점 없는 정수형이면 int 반환 (예: "2" → 2)
    - 소수점 있는 실수형이면 float 반환 (예: "1.5" → 1.5)
    - 비어 있거나 변환 불가 시 None 반환
    """
    v = str(value).strip() if value else ""
    if not v:
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (ValueError, TypeError):
        return None


def parse_motion(value: str) -> dict[str, list[str]] | None:
    """
    모션 조건 문자열을 딕셔너리로 변환.

    입력 예: "아침: 맑음 / 낮: 맑음, 비 / 새벽: 맑음"
    출력 예: {"아침": ["맑음"], "낮": ["맑음", "비"], "새벽": ["맑음"]}

    비어 있으면 None 반환 (JSON에서 키 자체를 생략하기 위함).
    """
    if not value or not value.strip():
        return None

    result: dict[str, list[str]] = {}
    for part in value.split(" / "):
        part = part.strip()
        if ": " not in part:
            continue
        time_key, conditions_str = part.split(": ", 1)
        conditions = [c.strip() for c in conditions_str.split(",") if c.strip()]
        if conditions:
            result[time_key.strip()] = conditions

    return result if result else None


# ─────────────────────────────────────────────────────────
# 물고기(Fish) 변환 로직
# ─────────────────────────────────────────────────────────

def convert_fish_row(row: dict[str, str]) -> dict[str, Any] | None:
    """
    CSV 한 행을 물고기 JSON 객체로 변환.

    CSV 컬럼: 이름, 레벨, 서식지, 크기, 시간대, 날씨, 판매가, 시즌, 이미지ID
    JSON 필드: name, level, habitat, size, time, weather, price, special, image(선택)

    이미지 경로: public/images/fish_img/fish_{image}.webp  ← 언더스코어 포함
    """
    name = str(row.get("이름", "")).strip()
    if not name:
        return None  # 빈 행 무시

    obj: dict[str, Any] = {
        "name":    name,
        "level":   parse_int(row.get("레벨", "")),
        "habitat": str(row.get("서식지", "")).strip(),
        "size":    str(row.get("크기", "")).strip(),
        "time":    parse_list_field(str(row.get("시간대", ""))),
        "weather": parse_list_field(str(row.get("날씨", ""))),
        "price":   parse_int(row.get("판매가", "")),
        "special": parse_special(str(row.get("시즌", ""))),
    }

    # 이미지ID: 없는 항목은 키 자체를 포함하지 않음
    image = parse_int(row.get("이미지ID", ""))
    if image is not None:
        obj["image"] = image

    return obj


# ─────────────────────────────────────────────────────────
# 곤충(Insect) 변환 로직
# ─────────────────────────────────────────────────────────

def convert_insect_row(row: dict[str, str]) -> dict[str, Any] | None:
    """
    CSV 한 행을 곤충 JSON 객체로 변환.

    CSV 컬럼: 이름, 레벨, 서식지, 시간대, 날씨, 판매가, 시즌, 이미지ID
    JSON 필드: name, level, habitat, time, weather, price, special, image(선택)

    이미지 경로: public/images/insect_img/insect{image}.webp  ← 언더스코어 없음
    """
    name = str(row.get("이름", "")).strip()
    if not name:
        return None

    obj: dict[str, Any] = {
        "name":    name,
        "level":   parse_int(row.get("레벨", "")),
        "habitat": str(row.get("서식지", "")).strip(),
        "time":    parse_list_field(str(row.get("시간대", ""))),
        "weather": parse_list_field(str(row.get("날씨", ""))),
        "price":   parse_int(row.get("판매가", "")),
        "special": parse_special(str(row.get("시즌", ""))),
    }

    image = parse_int(row.get("이미지ID", ""))
    if image is not None:
        obj["image"] = image

    return obj


# ─────────────────────────────────────────────────────────
# 새(Bird) 변환 로직
# ─────────────────────────────────────────────────────────

def convert_bird_row(row: dict[str, str]) -> dict[str, Any] | None:
    """
    CSV 한 행을 새 JSON 객체로 변환.

    CSV 컬럼: 이름, 레벨, 서식지, 카테고리, 시간대, 날씨, 판매가, 시즌, 이미지ID,
              깃털 다듬기 조건, 날개 펴기 조건
    JSON 필드: name, level, habitat, time, weather, price, special, category,
               motion_preening(선택), motion_wingspread(선택), image(선택)

    이미지 경로: public/images/bird_img/bird{image}.webp  ← 언더스코어 없음
    """
    name = str(row.get("이름", "")).strip()
    if not name:
        return None

    obj: dict[str, Any] = {
        "name":     name,
        "level":    parse_int(row.get("레벨", "")),
        "habitat":  str(row.get("서식지", "")).strip(),
        "time":     parse_list_field(str(row.get("시간대", ""))),
        "weather":  parse_list_field(str(row.get("날씨", ""))),
        "price":    parse_int(row.get("판매가", "")),
        "special":  parse_special(str(row.get("시즌", ""))),
        "category": str(row.get("카테고리", "")).strip(),
    }

    preening = parse_motion(str(row.get("깃털 다듬기 조건", "")))
    if preening is not None:
        obj["motion_preening"] = preening

    wingspread = parse_motion(str(row.get("날개 펴기 조건", "")))
    if wingspread is not None:
        obj["motion_wingspread"] = wingspread

    image = parse_int(row.get("이미지ID", ""))
    if image is not None:
        obj["image"] = image

    return obj


# ─────────────────────────────────────────────────────────
# 레시피(Recipe) 변환 로직
# ─────────────────────────────────────────────────────────

# 레시피 등급 배수를 convert_recipe_row() 실행 중 임시 저장하는 모듈 변수
_recipe_grade_mult:   dict[str, int | float] = {}
_recipe_stamina_mult: dict[str, int | float] = {}


def convert_recipe_row(row: dict[str, str]) -> dict[str, Any] | None:
    """
    CSV 한 행을 레시피 JSON 객체로 변환.

    CSV 컬럼: 이름, 판매가(1등급), 체력(1등급),
              재료1, 재료2, 재료3, 재료4,
              이미지, 시즌, 버프, 섭취 횟수, 먹이 가능,
              (빈 열), 등급, 판매 배수, 체력 배수

    JSON 필드: name, price, stamina, ingredients, image(선택), buff(선택),
               servings(선택, 기본값 1 → 저장 안 함), feedable(선택, false일 때만 저장)

    이미지: food_img/ 폴더의 텍스트 파일명 사용 (예: acupcake.webp)

    부수 효과:
      '등급' 컬럼에 값이 있는 행은 _recipe_grade_mult / _recipe_stamina_mult 에 저장
    """
    global _recipe_grade_mult, _recipe_stamina_mult

    # ── 등급 배수 정보 추출 ──────────────────────────────────────────
    grade_str = str(row.get("등급", "")).strip()
    if grade_str:
        raw_num   = grade_str.replace("등급", "").strip()
        # CSV 에서 소수 문자열("1.0")로 읽힐 수 있으므로 정수 문자열("1")로 정규화
        try:
            grade_num = str(int(float(raw_num)))
        except ValueError:
            grade_num = raw_num
        price_mult   = parse_number(row.get("판매 배수", ""))
        stamina_mult = parse_number(row.get("체력 배수", ""))
        if price_mult is not None:
            _recipe_grade_mult[grade_num] = price_mult
        if stamina_mult is not None:
            _recipe_stamina_mult[grade_num] = stamina_mult

    # ── 아이템 데이터 변환 ───────────────────────────────────────────
    name = str(row.get("이름", "")).strip()
    if not name:
        return None

    # 판매가 컬럼명 유연 처리: "판매가(1등급)" 또는 "판매가 (1등급)"
    price_raw = row.get("판매가(1등급)", row.get("판매가 (1등급)", "")).strip()
    if not price_raw:
        return None  # 가격 없는 행(범례, 메모 등) 건너뜀

    stamina_raw = row.get("체력(1등급)", row.get("체력 (1등급)", ""))

    # 재료1~4 컬럼을 읽어 비어 있지 않은 값만 리스트로 결합
    ingredients = [
        v for key in ("재료1", "재료2", "재료3", "재료4")
        if (v := str(row.get(key, "")).strip())
    ]

    obj: dict[str, Any] = {
        "name":        name,
        "price":       parse_int(price_raw),
        "stamina":     parse_int(stamina_raw),
        "ingredients": ingredients,
    }

    # 이미지: food_img/{image}.webp 형태로 사용됨 (텍스트 파일명)
    image = str(row.get("이미지", "")).strip()
    if image:
        obj["image"] = image

    # 버프: 값이 있을 때만 키 추가
    buff = str(row.get("버프", "")).strip()
    if buff:
        obj["buff"] = buff

    # 섭취 횟수: 비어 있거나 1이면 기본값이므로 저장 안 함 (JSON 크기 최적화)
    # 2 이상일 때만 "servings" 키를 추가
    servings = parse_int(row.get("섭취 횟수", ""))
    if servings is not None and servings > 1:
        obj["servings"] = servings

    # 먹이 가능: "False" / "FALSE" / "false" 일 때만 feedable: false 저장
    # True 또는 비어 있으면 기본값(먹일 수 있음)이므로 키 생략
    feedable_raw = str(row.get("먹이 가능", "")).strip().lower()
    if feedable_raw == "false":
        obj["feedable"] = False

    return obj


def convert_recipe(data_type: str) -> None:
    """
    레시피 CSV를 읽어 아래 3개 JSON 파일로 변환.
      - recipes.json                            ← 일반 레시피
      - season_ice/season_ice_recipes.json      ← 빙설 시즌 레시피
      - season_dreamlight/season_dreamlight_recipes.json  ← 꿈의 명암 시즌 레시피

    출력 형식 (래퍼 객체):
      {
        "gradeMultipliers":   { "1": 1, "2": 1.33, ... },
        "staminaMultipliers": { "1": 1, "2": 1.2, ... },
        "items": [ { ... }, ... ]
      }
    """
    global _recipe_grade_mult, _recipe_stamina_mult

    # 등급 배수 저장소 초기화 (이전 호출 결과가 남지 않도록)
    _recipe_grade_mult   = {}
    _recipe_stamina_mult = {}

    config   = CONVERTERS[data_type]
    csv_path = CSV_DIR / config["csv_file"]

    if not csv_path.exists():
        print(f"  ❌ CSV 파일을 찾을 수 없음: {csv_path}")
        return

    main_items:       list[dict] = []  # 일반 레시피
    ice_items:        list[dict] = []  # 빙설 레시피
    dreamlight_items: list[dict] = []  # 꿈의 명암 레시피

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            obj = convert_recipe_row(row)
            if obj is None:
                continue

            # 시즌 컬럼 값 기준으로 3-way 분류
            season_val = parse_special(str(row.get("시즌", "")))
            if season_val in SEASON_ICE_VALUES:
                obj["special"] = season_val
                ice_items.append(obj)
            elif season_val in SEASON_DREAMLIGHT_VALUES:
                obj["special"] = season_val
                dreamlight_items.append(obj)
            else:
                main_items.append(obj)

    # ── 메인 데이터 저장 (래퍼 구조) ────────────────────────────────
    _save_wrapped_json(
        config["main_output"],
        _recipe_grade_mult,
        _recipe_stamina_mult,
        main_items,
    )
    print(f"  ✅ {config['main_output'].relative_to(PROJECT_ROOT)}  ({len(main_items)}개)")

    # ── 빙설 데이터 저장 ────────────────────────────────────────────
    if ice_items:
        _save_wrapped_json(
            config["ice_output"],
            _recipe_grade_mult,
            _recipe_stamina_mult,
            ice_items,
        )
        print(f"  ✅ {config['ice_output'].relative_to(PROJECT_ROOT)}  ({len(ice_items)}개)")
    else:
        print(f"  ℹ️  빙설 레시피 없음 → 파일 미생성")

    # ── 꿈의 명암 데이터 저장 ────────────────────────────────────────
    if dreamlight_items:
        _save_wrapped_json(
            config["dreamlight_output"],
            _recipe_grade_mult,
            _recipe_stamina_mult,
            dreamlight_items,
        )
        print(f"  ✅ {config['dreamlight_output'].relative_to(PROJECT_ROOT)}  ({len(dreamlight_items)}개)")
    else:
        print(f"  ℹ️  꿈의 명암 레시피 없음 → 파일 미생성")


# ─────────────────────────────────────────────────────────
# 작물(Crops) 변환 로직
# ─────────────────────────────────────────────────────────

# 작물 등급 배수를 convert_crops_row() 실행 중 임시 저장하는 모듈 변수
_crop_grade_mult: dict[str, int | float] = {}


def convert_crops_row(row: dict[str, str]) -> dict[str, Any] | None:
    """
    CSV 한 행을 작물 JSON 객체로 변환.

    CSV 컬럼: 이름, 씨앗 가격, 수확 시간 (분), 판매가 (1등급), 이미지, 시즌,
              (빈 열), 등급, 판매 배수

    JSON 필드: name, seedPrice, harvestMinutes, sellPrice, image(선택)

    이미지: crop_img/{image}.webp 형태로 사용됨 (텍스트 파일명)
            엑셀의 오타 "corp_" → "crop_" 자동 수정

    부수 효과:
      '등급' 컬럼에 값이 있는 행은 _crop_grade_mult 에 저장
    """
    global _crop_grade_mult

    # ── 등급 배수 정보 추출 ──────────────────────────────────────────
    grade_str = str(row.get("등급", "")).strip()
    if grade_str:
        raw_num  = grade_str.replace("등급", "").strip()
        # CSV 에서 소수 문자열("1.0")로 읽힐 수 있으므로 정수 문자열("1")로 정규화
        try:
            grade_num = str(int(float(raw_num)))
        except ValueError:
            grade_num = raw_num
        mult = parse_number(row.get("판매 배수", ""))
        if mult is not None:
            _crop_grade_mult[grade_num] = mult

    # ── 아이템 데이터 변환 ───────────────────────────────────────────
    name = str(row.get("이름", "")).strip()
    if not name:
        return None

    # 씨앗 가격이 없는 행(범례, 메모 등)은 건너뜀
    # 컬럼명 유연 처리: "씨앗 가격" 또는 "씨앗가격"
    seed_raw = row.get("씨앗 가격", row.get("씨앗가격", "")).strip()
    if not seed_raw:
        return None

    # 컬럼명 유연 처리: "수확 시간 (분)" 또는 "수확시간(분)"
    harvest_raw  = row.get("수확 시간 (분)", row.get("수확시간(분)", ""))
    # 컬럼명 유연 처리: "판매가 (1등급)" 또는 "판매가(1등급)"
    sell_raw     = row.get("판매가 (1등급)", row.get("판매가(1등급)", ""))

    obj: dict[str, Any] = {
        "name":           name,
        "seedPrice":      parse_int(seed_raw),
        "harvestMinutes": parse_int(harvest_raw),
        "sellPrice":      parse_int(sell_raw),
    }

    # 이미지: crop_img/{image}.webp 형태로 사용됨 (텍스트 파일명)
    # 엑셀 오타 "corp_9201" → "crop_9201" 자동 수정
    image = str(row.get("이미지", "")).strip()
    if image:
        image = image.replace("corp_", "crop_")  # 엑셀 오타 수정
        obj["image"] = image

    return obj


def convert_crops(data_type: str) -> None:
    """
    작물 CSV를 읽어 아래 3개 JSON 파일로 변환.
      - crops.json                              ← 일반 작물
      - season_ice/season_ice_crops.json        ← 빙설 시즌 작물
      - season_dreamlight/season_dreamlight_crops.json  ← 꿈의 명암 시즌 작물

    출력 형식 (래퍼 객체):
      {
        "gradeMultipliers": { "1": 1.0, "2": 1.33, ... },
        "items": [ { ... }, ... ]
      }
    """
    global _crop_grade_mult

    _crop_grade_mult = {}

    config   = CONVERTERS[data_type]
    csv_path = CSV_DIR / config["csv_file"]

    if not csv_path.exists():
        print(f"  ❌ CSV 파일을 찾을 수 없음: {csv_path}")
        return

    main_items:       list[dict] = []
    ice_items:        list[dict] = []
    dreamlight_items: list[dict] = []

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            obj = convert_crops_row(row)
            if obj is None:
                continue

            season_val = parse_special(str(row.get("시즌", "")))
            if season_val in SEASON_ICE_VALUES:
                obj["special"] = season_val
                ice_items.append(obj)
            elif season_val in SEASON_DREAMLIGHT_VALUES:
                obj["special"] = season_val
                dreamlight_items.append(obj)
            else:
                main_items.append(obj)

    # ── 메인 데이터 저장 (래퍼 구조, staminaMultipliers 없음) ─────────
    _save_wrapped_json(config["main_output"], _crop_grade_mult, None, main_items)
    print(f"  ✅ {config['main_output'].relative_to(PROJECT_ROOT)}  ({len(main_items)}개)")

    if ice_items:
        _save_wrapped_json(config["ice_output"], _crop_grade_mult, None, ice_items)
        print(f"  ✅ {config['ice_output'].relative_to(PROJECT_ROOT)}  ({len(ice_items)}개)")
    else:
        print(f"  ℹ️  빙설 작물 없음 → 파일 미생성")

    if dreamlight_items:
        _save_wrapped_json(config["dreamlight_output"], _crop_grade_mult, None, dreamlight_items)
        print(f"  ✅ {config['dreamlight_output'].relative_to(PROJECT_ROOT)}  ({len(dreamlight_items)}개)")
    else:
        print(f"  ℹ️  꿈의 명암 작물 없음 → 파일 미생성")


# ─────────────────────────────────────────────────────────
# 상점(Shop) 변환 로직
# ─────────────────────────────────────────────────────────

def convert_shop_row(row: dict[str, str]) -> dict[str, Any] | None:
    """
    CSV 한 행을 상점 아이템 JSON 객체로 변환.

    CSV 컬럼: 이름, 구매가, 일일 한도, 구매 가능 시즌
    JSON 필드: name, shopPrice, dailyLimit, availability(선택)

    [시즌 처리 방식]
    상점 아이템은 fish/insect/bird 와 달리 시즌별로 파일을 분리하지 않습니다.
    대신 availability 필드로 구분하여 단일 shop.json 에 모두 저장합니다.
      - 항상 구매 가능: availability 필드 없음
      - 시즌 한정:      availability: "빙설" / "꿈의 명암" / "특별한 날씨"

    [레시피 원가 계산용 아이템 처리]
    페이지에 노출하지 않을 아이템(예: 물고기(50), 물고기(100) 등 원가 계산 전용)은
    JSON 파일에서 해당 항목에 "hidden": true 를 직접 추가하세요.
    상점 페이지는 hidden: true 인 항목을 자동으로 숨깁니다.
    """
    name = str(row.get("이름", "")).strip()
    if not name:
        return None

    # 구매가가 없는 행은 건너뜀
    price_raw = str(row.get("구매가", "")).strip()
    if not price_raw:
        return None

    obj: dict[str, Any] = {
        "name":       name,
        "shopPrice":  parse_int(price_raw),
        "dailyLimit": parse_int(row.get("일일 한도", "")),
    }

    # 구매 가능 시즌: 값이 있을 때만 포함 (없으면 항상 구매 가능)
    availability = str(row.get("구매 가능 시즌", "")).strip()
    if availability and availability not in ("None", "일반"):
        obj["availability"] = availability

    return obj


def convert_shop(data_type: str) -> None:
    """
    상점 CSV를 읽어 shop.json 단일 파일로 저장.

    상점 아이템은 시즌 분리 없이 모두 한 파일에 저장하고
    각 항목의 availability 필드로 시즌을 구분합니다.
    페이지에서 availability 필드를 읽어 시즌 필터를 적용하면 됩니다.
    """
    config   = CONVERTERS[data_type]
    csv_path = CSV_DIR / config["csv_file"]

    if not csv_path.exists():
        print(f"  ❌ CSV 파일을 찾을 수 없음: {csv_path}")
        return

    items: list[dict] = []

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            obj = convert_shop_row(row)
            if obj is not None:
                items.append(obj)

    save_json(config["main_output"], items)
    print(f"  ✅ {config['main_output'].relative_to(PROJECT_ROOT)}  ({len(items)}개)")


# ─────────────────────────────────────────────────────────
# 채집(Gather) 변환 로직
# ─────────────────────────────────────────────────────────

def convert_gather_row(row: dict[str, str]) -> dict[str, Any] | None:
    """
    CSV 한 행을 채집 아이템 JSON 객체로 변환.

    CSV 컬럼: 이름, 판매가, 숨김, 이미지
    JSON 필드: name, sellPrice, hidden(optional), image(optional)

    채집 아이템은 시즌 구분이 없으며 gather.json 단일 파일에 저장됩니다.
    이미지 경로: public/images/gather_img/{image}.webp
    """
    name = str(row.get("이름", "")).strip()
    if not name:
        return None

    sell_raw = str(row.get("판매가", "")).strip()
    if not sell_raw:
        return None

    # 기본 객체 먼저 생성
    obj: dict[str, Any] = {
        "name":      name,
        "sellPrice": parse_int(sell_raw),
    }

    # 숨김 여부 처리 - CSV의 "True" 문자열을 boolean True 로 변환
    # 값이 없는 경우(빈 문자열)에는 hidden 필드 자체를 생략
    hidden = str(row.get("숨김", "")).strip()
    if hidden:
        obj["hidden"] = hidden.lower() == "true"

    # 이미지: gather_img/{image}.webp 형태로 사용됨 (텍스트 파일명)
    # 엑셀에 이미지 컬럼이 추가된 경우에만 저장
    image = str(row.get("이미지", "")).strip()
    if image:
        obj["image"] = image

    return obj


def convert_gather(data_type: str) -> None:
    """
    채집 CSV를 읽어 gather.json 단일 파일로 저장.
    """
    config   = CONVERTERS[data_type]
    csv_path = CSV_DIR / config["csv_file"]

    if not csv_path.exists():
        print(f"  ❌ CSV 파일을 찾을 수 없음: {csv_path}")
        return

    items: list[dict] = []

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            obj = convert_gather_row(row)
            if obj is not None:
                items.append(obj)

    save_json(config["main_output"], items)
    print(f"  ✅ {config['main_output'].relative_to(PROJECT_ROOT)}  ({len(items)}개)")


# ─────────────────────────────────────────────────────────
# 변환기 설정 테이블
# 새 데이터 타입을 추가할 때 여기에만 항목을 넣으면 됩니다.
#
# [키 설명]
#   label           : 출력에 표시되는 한글 이름
#   csv_file        : tools/csv/ 폴더 기준 CSV 파일명
#   main_output     : 일반 시즌 JSON 출력 경로
#   ice_output      : 빙설 시즌 JSON 출력 경로 (시즌 분리가 없는 타입은 생략)
#   dreamlight_output: 꿈의 명암 시즌 JSON 출력 경로 (시즌 분리가 없는 타입은 생략)
#   converter       : 행 단위 변환 함수
#   custom_fn       : 파일 전체를 처리하는 커스텀 함수 (없으면 기본 convert() 사용)
#                     레시피·작물처럼 래퍼 구조 출력이 필요하거나
#                     상점·채집처럼 단순 저장이 필요한 경우 지정
# ─────────────────────────────────────────────────────────

CONVERTERS: dict[str, dict[str, Any]] = {
    # ── 물고기 ──────────────────────────────────────────────────────
    "fish": {
        "label":             "물고기",
        "csv_file":          "물고기.csv",
        "main_output":       DATA_DIR / "fish_data.json",
        "ice_output":        DATA_DIR / "season_ice"        / "season_ice_fish.json",
        "dreamlight_output": DATA_DIR / "season_dreamlight" / "season_dreamlight_fish.json",
        "converter":         convert_fish_row,
        # custom_fn 없음 → 기본 convert() 사용 (3-way 시즌 분리)
    },
    # ── 곤충 ────────────────────────────────────────────────────────
    "insect": {
        "label":             "곤충",
        "csv_file":          "곤충.csv",
        "main_output":       DATA_DIR / "insect_data.json",
        "ice_output":        DATA_DIR / "season_ice"        / "season_ice_insect.json",
        "dreamlight_output": DATA_DIR / "season_dreamlight" / "season_dreamlight_insect.json",
        "converter":         convert_insect_row,
    },
    # ── 새 ──────────────────────────────────────────────────────────
    "bird": {
        "label":             "새",
        "csv_file":          "새.csv",
        "main_output":       DATA_DIR / "bird_data.json",
        "ice_output":        DATA_DIR / "season_ice"        / "season_ice_bird.json",
        "dreamlight_output": DATA_DIR / "season_dreamlight" / "season_dreamlight_bird.json",
        "converter":         convert_bird_row,
    },
    # ── 레시피 ──────────────────────────────────────────────────────
    "recipe": {
        "label":             "레시피",
        "csv_file":          "레시피.csv",
        "main_output":       DATA_DIR / "recipes.json",
        "ice_output":        DATA_DIR / "season_ice"        / "season_ice_recipes.json",
        "dreamlight_output": DATA_DIR / "season_dreamlight" / "season_dreamlight_recipes.json",
        "converter":         convert_recipe_row,
        # 출력이 단순 배열이 아닌 래퍼 객체이므로 전용 함수 사용
        "custom_fn":         convert_recipe,
    },
    # ── 작물 ────────────────────────────────────────────────────────
    "crops": {
        "label":             "작물",
        "csv_file":          "작물.csv",
        "main_output":       DATA_DIR / "crops.json",
        "ice_output":        DATA_DIR / "season_ice"        / "season_ice_crops.json",
        "dreamlight_output": DATA_DIR / "season_dreamlight" / "season_dreamlight_crops.json",
        "converter":         convert_crops_row,
        # 등급 배수 래퍼 구조 출력을 위해 전용 함수 사용
        "custom_fn":         convert_crops,
    },
    # ── 상점 ────────────────────────────────────────────────────────
    # 시즌 분리 없이 availability 필드로 구분 (custom_fn 필수)
    "shop": {
        "label":     "상점",
        "csv_file":  "상점.csv",
        "main_output": DATA_DIR / "shop.json",
        "converter": convert_shop_row,
        "custom_fn": convert_shop,
    },
    # ── 채집 ────────────────────────────────────────────────────────
    # 시즌 구분 없음, 단순 배열 저장 (custom_fn 필수)
    "gather": {
        "label":       "채집",
        "csv_file":    "채집.csv",
        "main_output": DATA_DIR / "gather.json",
        "converter":   convert_gather_row,
        "custom_fn":   convert_gather,
    },
}


# ─────────────────────────────────────────────────────────
# 저장 유틸리티
# ─────────────────────────────────────────────────────────

def save_json(path: Path, data: list[dict]) -> None:
    """JSON 파일로 저장. 부모 디렉토리가 없으면 자동 생성."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _save_wrapped_json(
    path: Path,
    grade_mult: dict,
    stamina_mult: dict | None,
    items: list[dict],
) -> None:
    """
    등급 배수 래퍼 구조의 JSON 파일로 저장.
    레시피와 작물처럼 gradeMultipliers + items 형태가 필요한 경우 사용.

    stamina_mult 가 None이면 staminaMultipliers 키를 포함하지 않습니다 (작물 등).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    output: dict[str, Any] = {"gradeMultipliers": grade_mult}
    if stamina_mult is not None:
        output["staminaMultipliers"] = stamina_mult
    output["items"] = items
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────────────────
# 범용 변환 실행 함수 (fish, insect, bird 등 단순 배열 + 시즌 분리)
# ─────────────────────────────────────────────────────────

def convert(data_type: str) -> None:
    """
    지정된 타입의 CSV를 읽어 메인 / 빙설 / 꿈의 명암 JSON으로 3-way 분리 저장.

    CONVERTERS 에 ice_output 또는 dreamlight_output 이 없는 타입은
    해당 시즌 데이터가 있어도 저장하지 않습니다 (경고 출력).

    Args:
        data_type: CONVERTERS 딕셔너리의 키 (예: "fish", "insect", "bird")
    """
    config   = CONVERTERS[data_type]
    csv_path = CSV_DIR / config["csv_file"]

    if not csv_path.exists():
        print(f"  ❌ CSV 파일을 찾을 수 없음: {csv_path}")
        print(f"     → tools/csv/ 폴더에 '{config['csv_file']}' 파일을 넣어주세요.")
        return

    main_data:       list[dict] = []  # 일반 시즌
    ice_data:        list[dict] = []  # 빙설 시즌
    dreamlight_data: list[dict] = []  # 꿈의 명암 시즌

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            obj = config["converter"](row)
            if obj is None:
                continue

            # special 값(parse_special 반환값)으로 시즌 분류
            special = obj.get("special")
            if special in SEASON_ICE_VALUES:
                ice_data.append(obj)
            elif special in SEASON_DREAMLIGHT_VALUES:
                dreamlight_data.append(obj)
            else:
                main_data.append(obj)

    # ── 메인 데이터 저장 ─────────────────────────────────────────────
    save_json(config["main_output"], main_data)
    print(f"  ✅ {config['main_output'].relative_to(PROJECT_ROOT)}  ({len(main_data)}개)")

    # ── 빙설 데이터 저장 ─────────────────────────────────────────────
    if ice_data:
        ice_output = config.get("ice_output")
        if ice_output:
            save_json(ice_output, ice_data)
            print(f"  ✅ {ice_output.relative_to(PROJECT_ROOT)}  ({len(ice_data)}개)")
        else:
            print(f"  ⚠️  빙설 데이터 {len(ice_data)}개가 있지만 ice_output 경로 미설정 — 건너뜀")
    else:
        print(f"  ℹ️  빙설 데이터 없음 → 파일 미생성")

    # ── 꿈의 명암 데이터 저장 ────────────────────────────────────────
    if dreamlight_data:
        dl_output = config.get("dreamlight_output")
        if dl_output:
            save_json(dl_output, dreamlight_data)
            print(f"  ✅ {dl_output.relative_to(PROJECT_ROOT)}  ({len(dreamlight_data)}개)")
        else:
            print(f"  ⚠️  꿈의 명암 데이터 {len(dreamlight_data)}개가 있지만 dreamlight_output 경로 미설정 — 건너뜀")
    else:
        print(f"  ℹ️  꿈의 명암 데이터 없음 → 파일 미생성")


# ─────────────────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────────────────

def main() -> None:
    """
    CLI 인자에 따라 단일 또는 전체 타입을 변환.

    사용법:
      python tools/csv_to_json.py                                  # 전체 변환
      python tools/csv_to_json.py fish                             # 물고기만
      python tools/csv_to_json.py fish insect bird                 # 복수 지정
      python tools/csv_to_json.py fish insect bird recipe crops    # 시즌 분리 타입 전체
    """
    requested = sys.argv[1:] if len(sys.argv) > 1 else list(CONVERTERS.keys())

    print(f"\n{'─' * 50}")
    print(f"  heartopia CSV → JSON 변환기")
    print(f"  CSV 소스: {CSV_DIR.relative_to(PROJECT_ROOT)}/")
    print(f"{'─' * 50}")

    for data_type in requested:
        if data_type not in CONVERTERS:
            available = ", ".join(CONVERTERS.keys())
            print(f"\n  ❌ 알 수 없는 타입: '{data_type}'")
            print(f"     사용 가능: {available}")
            continue

        label = CONVERTERS[data_type]["label"]
        print(f"\n  [{label}] 변환 중...")

        # custom_fn 이 지정된 타입은 해당 함수로 처리
        # 지정되지 않은 타입은 기본 convert() 로 처리 (단순 배열 + 3-way 시즌 분리)
        custom_fn = CONVERTERS[data_type].get("custom_fn")
        if custom_fn is not None:
            custom_fn(data_type)
        else:
            convert(data_type)

    print(f"\n{'─' * 50}\n  완료!\n{'─' * 50}\n")


if __name__ == "__main__":
    main()
