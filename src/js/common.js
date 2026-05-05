// ============================================================
// 공통 설정
// ============================================================

// 사이트 루트 URL (도메인이 바뀌어도 여기 한 줄만 수정하면 됨)
// window.location.origin 을 사용하면 localhost / GitHub Pages 양쪽에서 자동으로 동작함
const BASE = window.location.origin + '/heartopia';


// ============================================================
// 공통 컴포넌트 로더
// ============================================================
async function loadComponent(elementId, fileName) {
    try {
        const response = await fetch(`${BASE}/src/components/${fileName}`);
        if (!response.ok) return;

        let html = await response.text();

        // header.html 내 [BASE] 플레이스홀더를 실제 BASE URL로 치환
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
