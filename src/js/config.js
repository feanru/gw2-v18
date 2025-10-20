const DEFAULT_CONFIG = {
  API_BASE_URL: '/api',
  CDN_BASE_URL: '',
  DEFAULT_LANG: 'es',
  FALLBACK_LANGS: ['en'],
  MARKET_CSV_URL: 'https://api.datawars2.ie/gw2/v1/items/csv',
  GW2_API_KEY: '',
  priceCacheStrategy: 'sessionStorage',
  FEATURE_USE_PRECOMPUTED: false,
  FEATURE_MARKET_CSV_EXTERNAL: true, // Frontend keeps using the legacy external CSV feed.
  FEATURE_MARKET_CSV_EXTERNAL_WORKER: false, // Worker stays on internal CSV unless explicitly enabled.
  FEATURE_DONES_AGGREGATE: false,
  PRECOMPUTED_CANARY_THRESHOLD: 1,
  FETCH_GUARD_MODE: 'enforce',
  FETCH_GUARD_WHITELIST: [],
  CONNECT_ALLOWLIST: [],
  FETCH_GUARD_REPORT_URL: null,
  FEATURE_ITEM_API_ROLLOUT: false,
};

function toBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value == null) {
    return defaultValue;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return defaultValue;
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function applySource(target, source) {
  if (!source || typeof source !== 'object') {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'API_BASE_URL') && source.API_BASE_URL != null) {
    target.API_BASE_URL = source.API_BASE_URL;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'CDN_BASE_URL') && source.CDN_BASE_URL != null) {
    target.CDN_BASE_URL = source.CDN_BASE_URL;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'DEFAULT_LANG') && source.DEFAULT_LANG) {
    target.DEFAULT_LANG = source.DEFAULT_LANG;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'LANG') && source.LANG) {
    target.DEFAULT_LANG = source.LANG;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'MARKET_CSV_URL') && source.MARKET_CSV_URL) {
    target.MARKET_CSV_URL = source.MARKET_CSV_URL;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'GW2_API_KEY') && source.GW2_API_KEY != null) {
    target.GW2_API_KEY = source.GW2_API_KEY;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'priceCacheStrategy') && source.priceCacheStrategy) {
    target.priceCacheStrategy = source.priceCacheStrategy;
  } else if (Object.prototype.hasOwnProperty.call(source, 'PRICE_CACHE_STRATEGY') && source.PRICE_CACHE_STRATEGY) {
    target.priceCacheStrategy = source.PRICE_CACHE_STRATEGY;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FEATURE_USE_PRECOMPUTED')) {
    target.FEATURE_USE_PRECOMPUTED = source.FEATURE_USE_PRECOMPUTED;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FEATURE_MARKET_CSV_EXTERNAL')) {
    target.FEATURE_MARKET_CSV_EXTERNAL = source.FEATURE_MARKET_CSV_EXTERNAL;
  } else if (Object.prototype.hasOwnProperty.call(source, 'FEATURE_MARKET_CSV_INTERNAL')) {
    // Legacy flag: true meant "use internal"; false allowed external CSV.
    target.FEATURE_MARKET_CSV_EXTERNAL = !toBoolean(
      source.FEATURE_MARKET_CSV_INTERNAL,
      true,
    );
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FEATURE_MARKET_CSV_EXTERNAL_WORKER')) {
    target.FEATURE_MARKET_CSV_EXTERNAL_WORKER = source.FEATURE_MARKET_CSV_EXTERNAL_WORKER;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FEATURE_DONES_AGGREGATE')) {
    target.FEATURE_DONES_AGGREGATE = source.FEATURE_DONES_AGGREGATE;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FEATURE_ITEM_API_ROLLOUT')) {
    target.FEATURE_ITEM_API_ROLLOUT = source.FEATURE_ITEM_API_ROLLOUT;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'PRECOMPUTED_CANARY_THRESHOLD')) {
    target.PRECOMPUTED_CANARY_THRESHOLD = source.PRECOMPUTED_CANARY_THRESHOLD;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FETCH_GUARD_MODE')
    && typeof source.FETCH_GUARD_MODE === 'string') {
    target.FETCH_GUARD_MODE = source.FETCH_GUARD_MODE;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FETCH_GUARD_WHITELIST')) {
    const whitelist = source.FETCH_GUARD_WHITELIST;
    if (Array.isArray(whitelist)) {
      target.FETCH_GUARD_WHITELIST = [...whitelist];
    } else if (typeof whitelist === 'string') {
      const entries = whitelist
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      target.FETCH_GUARD_WHITELIST = entries;
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'CONNECT_ALLOWLIST')
    && Array.isArray(source.CONNECT_ALLOWLIST)) {
    target.CONNECT_ALLOWLIST = [...source.CONNECT_ALLOWLIST];
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FALLBACK_LANGS')) {
    const fallback = source.FALLBACK_LANGS;
    if (Array.isArray(fallback)) {
      target.FALLBACK_LANGS = [...fallback];
    } else if (typeof fallback === 'string') {
      target.FALLBACK_LANGS = fallback
        .split(',')
        .map((lang) => lang.trim())
        .filter(Boolean);
    }
  } else if (Object.prototype.hasOwnProperty.call(source, 'FALLBACK_LANG')) {
    const fallback = source.FALLBACK_LANG;
    if (typeof fallback === 'string') {
      target.FALLBACK_LANGS = fallback
        .split(',')
        .map((lang) => lang.trim())
        .filter(Boolean);
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'FETCH_GUARD_REPORT_URL')) {
    const reportUrl = source.FETCH_GUARD_REPORT_URL;
    if (reportUrl == null || typeof reportUrl === 'string') {
      target.FETCH_GUARD_REPORT_URL = reportUrl;
    }
  }
}

function readWindow() {
  if (typeof globalThis !== 'undefined') {
    if (globalThis.window && typeof globalThis.window === 'object') {
      return globalThis.window;
    }
    if (globalThis.self && typeof globalThis.self === 'object') {
      return globalThis.self;
    }
    return globalThis;
  }
  if (typeof self !== 'undefined') {
    return self;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  return undefined;
}

export function getConfig() {
  const base = {
    ...DEFAULT_CONFIG,
    FETCH_GUARD_WHITELIST: [...DEFAULT_CONFIG.FETCH_GUARD_WHITELIST],
    CONNECT_ALLOWLIST: [...DEFAULT_CONFIG.CONNECT_ALLOWLIST],
  };
  const globalWindow = readWindow();
  const globalScope = globalWindow
    || (typeof globalThis !== 'undefined' ? globalThis : undefined);
  const legacy = globalScope && typeof globalScope.Config === 'object'
    ? globalScope.Config
    : null;
  const runtime = globalScope && typeof globalScope.__RUNTIME_CONFIG__ === 'object'
    ? globalScope.__RUNTIME_CONFIG__
    : null;
  const secureRuntime = globalScope && typeof globalScope.__SECURE_RUNTIME_CONFIG__ === 'object'
    ? globalScope.__SECURE_RUNTIME_CONFIG__
    : null;

  applySource(base, legacy);
  applySource(base, runtime);
  applySource(base, secureRuntime);

  base.FEATURE_USE_PRECOMPUTED = toBoolean(
    base.FEATURE_USE_PRECOMPUTED,
    DEFAULT_CONFIG.FEATURE_USE_PRECOMPUTED,
  );
  base.FEATURE_MARKET_CSV_EXTERNAL = toBoolean(
    base.FEATURE_MARKET_CSV_EXTERNAL,
    DEFAULT_CONFIG.FEATURE_MARKET_CSV_EXTERNAL,
  );
  base.FEATURE_MARKET_CSV_EXTERNAL_WORKER = toBoolean(
    base.FEATURE_MARKET_CSV_EXTERNAL_WORKER,
    DEFAULT_CONFIG.FEATURE_MARKET_CSV_EXTERNAL_WORKER,
  );
  base.FEATURE_ITEM_API_ROLLOUT = toBoolean(
    base.FEATURE_ITEM_API_ROLLOUT,
    DEFAULT_CONFIG.FEATURE_ITEM_API_ROLLOUT,
  );
  const parsedThreshold = Number(base.PRECOMPUTED_CANARY_THRESHOLD);
  base.PRECOMPUTED_CANARY_THRESHOLD = Number.isFinite(parsedThreshold)
    ? Math.min(Math.max(parsedThreshold, 0), 100)
    : DEFAULT_CONFIG.PRECOMPUTED_CANARY_THRESHOLD;
  const fallbackList = Array.isArray(base.FALLBACK_LANGS)
    ? base.FALLBACK_LANGS
    : typeof base.FALLBACK_LANGS === 'string'
      ? base.FALLBACK_LANGS.split(',')
      : [];

  if (base.CDN_BASE_URL != null && base.CDN_BASE_URL !== '') {
    const normalizedCdn = String(base.CDN_BASE_URL).trim().replace(/\/$/, '');
    base.CDN_BASE_URL = normalizedCdn;
  } else {
    base.CDN_BASE_URL = '';
  }
  const normalizedDefaultLang = String(base.DEFAULT_LANG || DEFAULT_CONFIG.DEFAULT_LANG || '')
    .trim()
    .toLowerCase();
  base.FALLBACK_LANGS = [...new Set(fallbackList
    .map((lang) => (typeof lang === 'string' ? lang.trim().toLowerCase() : ''))
    .filter((lang) => lang && lang !== normalizedDefaultLang))];
  base.LANG = base.DEFAULT_LANG || DEFAULT_CONFIG.DEFAULT_LANG;
  const normalizedActiveLang = String(base.LANG || '').trim().toLowerCase();
  base.FALLBACK_LANGS = base.FALLBACK_LANGS.filter((lang) => lang && lang !== normalizedActiveLang);

  return base;
}

export { DEFAULT_CONFIG };
