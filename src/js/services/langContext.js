import { getConfig } from '../config.js';

const FALLBACK_DEFAULT_LANG = 'es';
let lastSyncedLang = null;
let syncingPromise = null;

function normalizeLang(lang) {
  if (typeof lang !== 'string') {
    return null;
  }
  const trimmed = lang.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function getActiveLanguage() {
  try {
    const config = getConfig();
    const fromConfig = normalizeLang(config?.LANG);
    if (fromConfig) {
      return fromConfig;
    }
    const defaultLang = normalizeLang(config?.DEFAULT_LANG);
    if (defaultLang) {
      return defaultLang;
    }
  } catch (err) {
    // Ignore config resolution issues and fall back to default
  }
  return FALLBACK_DEFAULT_LANG;
}

function ensureServiceWorkerReady() {
  if (typeof navigator === 'undefined' || !navigator?.serviceWorker) {
    return Promise.resolve(null);
  }
  if (!syncingPromise) {
    syncingPromise = navigator.serviceWorker.ready
      .then((registration) => registration?.active ?? null)
      .catch(() => null);
  }
  return syncingPromise;
}

function postLangMessage(target, lang) {
  if (!target || typeof target.postMessage !== 'function' || !lang) {
    return;
  }
  try {
    target.postMessage({ type: 'setLang', lang });
  } catch (err) {
    // Ignore messaging issues
  }
}

export function syncServiceWorkerLanguage(lang = getActiveLanguage()) {
  const normalized = normalizeLang(lang);
  if (!normalized || normalized === lastSyncedLang) {
    return;
  }

  if (typeof navigator !== 'undefined' && navigator?.serviceWorker) {
    postLangMessage(navigator.serviceWorker.controller, normalized);
    ensureServiceWorkerReady().then((active) => {
      if (active) {
        postLangMessage(active, normalized);
      }
    });
  }

  lastSyncedLang = normalized;
}

function appendLangParam(url, lang) {
  if (!lang) {
    return url;
  }
  try {
    const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url);
    const base = hasProtocol
      ? undefined
      : (typeof window !== 'undefined' && window?.location?.origin)
        ? window.location.origin
        : 'http://localhost';
    const parsed = new URL(url, base);
    if (!parsed.searchParams.has('lang')) {
      parsed.searchParams.set('lang', lang);
    }
    if (hasProtocol) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (err) {
    return url;
  }
}

function buildHeaders(sourceHeaders = undefined, lang) {
  if (!lang) {
    return sourceHeaders || undefined;
  }
  const headers = new Headers(sourceHeaders || undefined);
  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', lang);
  }
  headers.set('X-Client-Language', lang);
  return headers;
}

export function prepareLangRequest(url, options = {}) {
  const lang = getActiveLanguage();
  syncServiceWorkerLanguage(lang);

  const finalUrl = appendLangParam(url, lang);
  const { headers: incomingHeaders, ...rest } = options || {};
  const headers = buildHeaders(incomingHeaders, lang);
  const finalOptions = headers ? { ...rest, headers } : { ...rest };

  return { url: finalUrl, options: finalOptions, lang };
}
