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
// 전체 언어 전환 (한국어 / 일본어)
// ============================================================
const LANGUAGE_STORAGE_KEY = 'heartopia_language';
let currentLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'ko';
let localeData = {};

async function loadLocale(lang) {
    const response = await fetch(`${BASE}/src/locales/${lang}.json`);
    if (!response.ok) throw new Error(`언어 파일을 불러오지 못했습니다: ${lang}`);
    return response.json();
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((value, key) => value && value[key], obj);
}

function t(key, fallback = '') {
    return getNestedValue(localeData, key) ?? fallback ?? key;
}

const originalTextNodes = new WeakMap();
const originalAttributes = new WeakMap();

function translateKoreanText(value) {
    if (currentLanguage !== 'ja' || !value) return value;
    const entries = Object.entries(localeData.text || {})
        .sort((a, b) => b[0].length - a[0].length);
    let translated = value;
    for (const [ko, ja] of entries) {
        translated = translated.split(ko).join(ja);
    }
    return translated;
}

function translateTextNodes(scope = document) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || (!originalTextNodes.has(node) && !/[가-힣]/.test(node.nodeValue))) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

            // data-i18n 요소는 applyStaticTranslations()가 완성된 문구를 직접 넣는다.
            // 여기서 다시 문자열 치환을 하면 카드 제목 일부가 잘리는 문제가 생기므로 제외한다.
            if (parent.closest('[data-i18n], [data-i18n-placeholder], [data-i18n-title]')) {
                return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
        if (!originalTextNodes.has(node)) originalTextNodes.set(node, node.nodeValue);
        const original = originalTextNodes.get(node);
        node.nodeValue = currentLanguage === 'ja' ? translateKoreanText(original) : original;
    });

    scope.querySelectorAll?.('[placeholder], [title], [aria-label]').forEach((el) => {
        let attrs = originalAttributes.get(el);
        if (!attrs) {
            attrs = {};
            ['placeholder', 'title', 'aria-label'].forEach((attr) => {
                if (el.hasAttribute(attr)) attrs[attr] = el.getAttribute(attr);
            });
            originalAttributes.set(el, attrs);
        }
        Object.entries(attrs).forEach(([attr, original]) => {
            el.setAttribute(attr, currentLanguage === 'ja' ? translateKoreanText(original) : original);
        });
    });
}

function observeLanguageChanges() {
    const observer = new MutationObserver((mutations) => {
        if (currentLanguage !== 'ja') return;
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const parent = node.parentElement;
                    if (parent) translateTextNodes(parent);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    translateTextNodes(node);
                }
            });
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

function applyStaticTranslations(scope = document) {
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.dataset.i18n;

        // 처음 읽은 한국어 원문을 보존해야 일본어 ↔ 한국어를 여러 번 바꿔도
        // 일본어가 그대로 남지 않는다.
        if (!el.dataset.i18nFallback) {
            el.dataset.i18nFallback = el.textContent.trim();
        }
        const fallback = el.dataset.i18nFallback;
        el.textContent = currentLanguage === 'ja' ? t(key, fallback) : fallback;
    });

    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.dataset.i18nPlaceholder;
        if (!el.dataset.i18nPlaceholderFallback) {
            el.dataset.i18nPlaceholderFallback = el.getAttribute('placeholder') || '';
        }
        const fallback = el.dataset.i18nPlaceholderFallback;
        el.setAttribute('placeholder', currentLanguage === 'ja' ? t(key, fallback) : fallback);
    });

    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.dataset.i18nTitle;
        if (!el.dataset.i18nTitleFallback) {
            el.dataset.i18nTitleFallback = el.getAttribute('title') || '';
        }
        const fallback = el.dataset.i18nTitleFallback;
        el.setAttribute('title', currentLanguage === 'ja' ? t(key, fallback) : fallback);
    });

    translateTextNodes(scope);
    document.documentElement.lang = currentLanguage === 'ja' ? 'ja' : 'ko';
}

async function setSiteLanguage(lang) {
    if (!['ko', 'ja'].includes(lang)) return;
    currentLanguage = lang;
    document.documentElement.lang = lang;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    localeData = await loadLocale(lang);
    applyStaticTranslations();
    document.dispatchEvent(new CustomEvent('site-language-changed', { detail: { lang } }));
}

function toggleSiteLanguage() {
    return setSiteLanguage(currentLanguage === 'ko' ? 'ja' : 'ko');
}

window.getSiteLanguage = () => currentLanguage;
window.setSiteLanguage = setSiteLanguage;
window.toggleSiteLanguage = toggleSiteLanguage;
window.getLocalizedName = (item) => (
    currentLanguage === 'ja' && item && item.nameJa ? item.nameJa : item?.name
);
window.t = t;
window.applyStaticTranslations = applyStaticTranslations;


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
        if (el) {
            el.innerHTML = html;
            applyStaticTranslations(el);
        }
    } catch (e) {
        console.error('컴포넌트 로드 오류:', e);
    }
}


// ============================================================
// DOMContentLoaded: 헤더·푸터 주입 + 스크롤 탑 버튼
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    document.documentElement.lang = currentLanguage;
    try {
        localeData = await loadLocale(currentLanguage);
    } catch (error) {
        console.error('언어 파일 로드 오류:', error);
        currentLanguage = 'ko';
        localeData = {};
    }

    await Promise.all([
        loadComponent('header-placeholder', 'header.html'),
        loadComponent('footer-placeholder', 'footer.html')
    ]);
    applyStaticTranslations();
    initScrollTopBtn();
    observeLanguageChanges();
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
    document.addEventListener('site-language-changed', () => {
        btn.setAttribute('aria-label', currentLanguage === 'ja' ? 'ページ上部へ' : '맨 위로');
    });
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


// ── Google Analytics 자동 주입 ──
// GA 스크립트를 각 페이지에 반복 삽입하지 않고 common.js 에서 일괄 처리
(function injectGA() {
    const GA_ID = 'G-RXTDCP8G1V'; // GA Measurement ID (공개 값이므로 소스에 포함 무방)
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(script);

    // dataLayer 초기화 및 gtag 함수 등록
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID);
})();
