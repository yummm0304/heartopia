// ============================================================
// 공통 설정
// ============================================================

// 사이트 루트 URL — 배포 위치에 관계없이 자동 계산
// common.js는 항상 {PROJECT_ROOT}/src/js/common.js 에 위치하므로,
// 자신의 스크립트 URL에서 '/src/js/common.js' 부분을 제거하면 루트를 역산할 수 있음
// 예) https://domain.com/src/js/common.js           → https://domain.com
// 예) https://domain.com/heartopia/src/js/common.js → https://domain.com/heartopia
// 예) http://localhost:8080/heartopia/src/js/common.js → http://localhost:8080/heartopia
const BASE = (document.currentScript?.src || '')
    .replace(/\/src\/js\/common\.js(\?.*)?$/, '');


// ============================================================
// 공통 컴포넌트 로더
// ============================================================
async function loadComponent(elementId, fileName) {
    try {
        const response = await fetch(`${BASE}/src/components/${fileName}`);
        if (!response.ok) return;

        let html = await response.text();

        // header.html 내 {{BASE}} 플레이스홀더를 실제 BASE URL로 치환
        // → 새 페이지가 추가되어도 이 로직은 수정할 필요 없음
        html = html.replaceAll('[BASE]', BASE);

        const el = document.getElementById(elementId);
        if (el) el.innerHTML = html;
    } catch (e) {
        console.error('컴포넌트 로드 오류:', e);
    }
}


// ============================================================
// DOMContentLoaded: 헤더·푸터 주입 + 스크롤 탑 버튼
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadComponent('header-placeholder', 'header.html');
    loadComponent('footer-placeholder', 'footer.html');
    initScrollTopBtn();
});


// ============================================================
// 스크롤 탑 버튼
// ─ JS로 버튼을 직접 생성하므로 HTML 파일을 수정할 필요 없음
// ============================================================
function initScrollTopBtn() {
    // 버튼 요소 생성
    const btn = document.createElement('button');
    btn.id = 'scroll-top-btn';
    btn.setAttribute('aria-label', '맨 위로');
    btn.textContent = 'Top▲';
    document.body.appendChild(btn);

    // 300px 이상 스크롤하면 버튼 표시, 그 전엔 숨김
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    }, { passive: true }); // passive: true → 스크롤 성능 최적화

    // 클릭 시 부드럽게 최상단으로 이동
    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}
