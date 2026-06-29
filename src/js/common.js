// ============================================================
// Heartopia 공통 스크립트 — 한국어 / 日本語 전환
// ============================================================
const BASE = (document.currentScript?.src || '')
    .replace(/\/src\/js\/common\.js(\?.*)?$/, '');

const LANGUAGE_STORAGE_KEY = 'heartopia_language';
let currentLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'ko';
let localeData = {};

async function loadLocale(lang) {
    const response = await fetch(`${BASE}/src/locales/${lang}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Locale load failed: ${lang}`);
    return response.json();
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((value, key) => value && value[key], obj);
}

function t(key, fallback = '') {
    return getNestedValue(localeData, key) ?? fallback;
}

function localizedName(item) {
    if (!item) return '';
    return currentLanguage === 'ja' ? (item.nameJa || translatePlainText(item.name || '')) : (item.name || '');
}

window.t = t;
window.getSiteLanguage = () => currentLanguage;
window.getLocalizedName = localizedName;

const originalTextNodes = new WeakMap();
const originalAttributes = new WeakMap();

function translatePlainText(value) {
    if (currentLanguage !== 'ja' || !value) return value;

    const entries = Object.entries(localeData.text || {})
        .filter(([ko]) => ko)
        .sort((a, b) => b[0].length - a[0].length);

    let result = value;
    for (const [ko, ja] of entries) {
        result = result.split(ko).join(ja);
    }
    return result;
}

function translateTextNodes(scope = document) {
    const root = scope.nodeType === Node.ELEMENT_NODE || scope.nodeType === Node.DOCUMENT_NODE
        ? scope : scope.parentElement;
    if (!root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION'].includes(parent.tagName)) {
                return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest('[data-i18n], [data-i18n-placeholder], [data-i18n-title]')) {
                return NodeFilter.FILTER_REJECT;
            }
            const original = originalTextNodes.get(node) ?? node.nodeValue;
            return /[가-힣]/.test(original || '')
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
        }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
        if (!originalTextNodes.has(node)) originalTextNodes.set(node, node.nodeValue);
        const original = originalTextNodes.get(node);
        node.nodeValue = currentLanguage === 'ja' ? translatePlainText(original) : original;
    }

    root.querySelectorAll?.('[placeholder], [title], [aria-label]').forEach((el) => {
        let attrs = originalAttributes.get(el);
        if (!attrs) {
            attrs = {};
            ['placeholder', 'title', 'aria-label'].forEach((attr) => {
                if (el.hasAttribute(attr)) attrs[attr] = el.getAttribute(attr);
            });
            originalAttributes.set(el, attrs);
        }
        for (const [attr, original] of Object.entries(attrs)) {
            el.setAttribute(attr, currentLanguage === 'ja' ? translatePlainText(original) : original);
        }
    });
}

function applyStaticTranslations(scope = document) {
    scope.querySelectorAll?.('[data-i18n]').forEach((el) => {
        const key = el.dataset.i18n;
        if (!el.dataset.i18nFallback) el.dataset.i18nFallback = el.textContent.trim();
        const fallback = el.dataset.i18nFallback;
        el.textContent = currentLanguage === 'ja' ? t(key, fallback) : fallback;
    });

    scope.querySelectorAll?.('[data-i18n-placeholder]').forEach((el) => {
        const key = el.dataset.i18nPlaceholder;
        if (!el.dataset.i18nPlaceholderFallback) {
            el.dataset.i18nPlaceholderFallback = el.getAttribute('placeholder') || '';
        }
        const fallback = el.dataset.i18nPlaceholderFallback;
        el.setAttribute('placeholder', currentLanguage === 'ja' ? t(key, fallback) : fallback);
    });

    scope.querySelectorAll?.('[data-i18n-title]').forEach((el) => {
        const key = el.dataset.i18nTitle;
        if (!el.dataset.i18nTitleFallback) {
            el.dataset.i18nTitleFallback = el.getAttribute('title') || '';
        }
        const fallback = el.dataset.i18nTitleFallback;
        el.setAttribute('title', currentLanguage === 'ja' ? t(key, fallback) : fallback);
    });

    document.documentElement.lang = currentLanguage;
    translateTextNodes(scope);
}

async function setSiteLanguage(lang) {
    if (!['ko', 'ja'].includes(lang)) return;

    currentLanguage = lang;
    document.documentElement.lang = lang;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);

    try {
        localeData = await loadLocale(lang);
    } catch (error) {
        console.error(error);
        localeData = {};
    }

    applyStaticTranslations(document);
    document.dispatchEvent(new CustomEvent('site-language-changed', { detail: { lang } }));
}

function toggleSiteLanguage() {
    return setSiteLanguage(currentLanguage === 'ko' ? 'ja' : 'ko');
}

window.setSiteLanguage = setSiteLanguage;
window.toggleSiteLanguage = toggleSiteLanguage;
window.applyStaticTranslations = applyStaticTranslations;

async function loadComponent(elementId, fileName) {
    try {
        const response = await fetch(`${BASE}/src/components/${fileName}`, { cache: 'no-store' });
        if (!response.ok) return;
        const html = (await response.text()).replaceAll('[BASE]', BASE);
        const el = document.getElementById(elementId);
        if (el) {
            el.innerHTML = html;
            applyStaticTranslations(el);
        }
    } catch (error) {
        console.error(error);
    }
}

function initScrollTopBtn() {
    if (document.getElementById('scroll-top-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'scroll-top-btn';
    btn.setAttribute('aria-label', currentLanguage === 'ja' ? 'ページ上部へ' : '맨 위로');
    btn.textContent = 'Top▲';
    document.addEventListener('site-language-changed', () => {
        btn.setAttribute('aria-label', currentLanguage === 'ja' ? 'ページ上部へ' : '맨 위로');
    });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 300), { passive: true });
    document.body.appendChild(btn);
}

function observeLanguageChanges() {
    const observer = new MutationObserver((mutations) => {
        if (currentLanguage !== 'ja') return;
        for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    applyStaticTranslations(node);
                } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
                    translateTextNodes(node.parentElement);
                }
            });
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

document.addEventListener('DOMContentLoaded', async () => {
    document.documentElement.lang = currentLanguage;
    try {
        localeData = await loadLocale(currentLanguage);
    } catch (error) {
        console.error(error);
        currentLanguage = 'ko';
        localeData = {};
    }

    await Promise.all([
        loadComponent('header-placeholder', 'header.html'),
        loadComponent('footer-placeholder', 'footer.html')
    ]);

    applyStaticTranslations(document);
    initScrollTopBtn();
    observeLanguageChanges();
});
