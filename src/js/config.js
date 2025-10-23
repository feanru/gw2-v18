import {
  syncAssignments as syncCanaryAssignments,
  normalizeScopeKey as normalizeCanaryScopeKey,
  MAX_BUCKET as CANARY_MAX_BUCKET,
  DEFAULT_SCOPE as CANARY_DEFAULT_SCOPE,
} from './utils/canaryBucket.js';

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
  CANARY_ASSIGNMENTS: {},
  CANARY_ROLLOUTS: null,
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

function detectDebugMode({ legacy, runtime, secureRuntime, globalScope }) {
  const candidates = [
    secureRuntime && (secureRuntime.DEBUG_RUNTIME ?? secureRuntime.DEBUG),
    runtime && (runtime.DEBUG_RUNTIME ?? runtime.DEBUG),
    legacy && (legacy.DEBUG_RUNTIME ?? legacy.DEBUG),
    globalScope && (globalScope.__RUNTIME_DEBUG__ ?? globalScope.__DEBUG__),
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return toBoolean(candidate, false);
    }
  }

  if (globalScope && globalScope.location && typeof globalScope.location.search === 'string') {
    const search = String(globalScope.location.search || '');
    if (search) {
      try {
        const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
        const keys = ['debugRuntime', 'runtimeDebug', 'debug-config'];
        for (const key of keys) {
          if (params.has(key)) {
            const value = params.get(key);
            return toBoolean(value == null ? true : value, true);
          }
        }
      } catch (error) {
        if (/[?&](debugRuntime|runtimeDebug|debug-config)(?:=|&|$)/i.test(search)) {
          return true;
        }
      }
    }
  }

  return false;
}

function emitRuntimeDebugLog({ debugMode, legacy, runtime, secureRuntime }) {
  if (!debugMode || typeof console === 'undefined' || console === null) {
    return;
  }

  const now = new Date();
  const payload = {
    legacyConfig: Boolean(legacy),
    runtimeConfig: Boolean(runtime),
    secureRuntimeConfig: Boolean(secureRuntime),
    runtimeLoadedAt: runtime && Object.prototype.hasOwnProperty.call(runtime, '__loadedAt')
      ? runtime.__loadedAt
      : null,
    configInitializedAt: now.toISOString(),
  };

  if (!runtime) {
    console.warn('[runtime-config][debug] runtime-env.js was not available during config initialization.', payload);
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(runtime, '__loadedAt')) {
    console.warn('[runtime-config][debug] runtime-env.js missing "__loadedAt" marker; verify load order.', payload);
    return;
  }

  const parsedRuntime = typeof runtime.__loadedAt === 'string'
    ? Date.parse(runtime.__loadedAt)
    : Number.isFinite(runtime.__loadedAt)
      ? Number(runtime.__loadedAt)
      : Number.NaN;

  if (Number.isNaN(parsedRuntime)) {
    console.warn('[runtime-config][debug] runtime-env.js has an invalid "__loadedAt" timestamp.', payload);
    return;
  }

  const deltaMs = now.getTime() - parsedRuntime;
  payload.runtimeLoadedDeltaMs = deltaMs;

  if (deltaMs < -50) {
    console.warn('[runtime-config][debug] runtime-env.js appears to have executed after config.js. Ensure /runtime-env.js loads first.', payload);
    return;
  }

  console.info('[runtime-config][debug] runtime configuration applied successfully.', {
    ...payload,
    lang: runtime.LANG,
    flags: runtime.FLAGS,
  });
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
  if (Object.prototype.hasOwnProperty.call(source, 'CANARY_ASSIGNMENTS')) {
    target.CANARY_ASSIGNMENTS = source.CANARY_ASSIGNMENTS;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'CANARY_ROLLOUTS')) {
    target.CANARY_ROLLOUTS = source.CANARY_ROLLOUTS;
  } else if (Object.prototype.hasOwnProperty.call(source, 'CANARY_THRESHOLDS')) {
    target.CANARY_ROLLOUTS = source.CANARY_THRESHOLDS;
  }
}

function clampCanaryThreshold(value) {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.floor(numeric);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > CANARY_MAX_BUCKET) {
    return CANARY_MAX_BUCKET;
  }
  return rounded;
}

function cloneAssignments(assignments) {
  const result = {};
  if (!assignments || typeof assignments !== 'object') {
    return result;
  }
  for (const [key, value] of Object.entries(assignments)) {
    if (!key || !value || typeof value !== 'object') {
      continue;
    }
    result[key] = { ...value };
  }
  return result;
}

function normalizeCanaryRollouts(rawValue, fallbackThreshold) {
  const defaultThreshold = clampCanaryThreshold(
    fallbackThreshold != null ? fallbackThreshold : DEFAULT_CONFIG.PRECOMPUTED_CANARY_THRESHOLD,
  );
  const baseDefault = {
    scope: CANARY_DEFAULT_SCOPE,
    threshold: defaultThreshold,
  };
  const normalized = {
    default: { ...baseDefault },
    features: {},
    screens: {},
    scopes: { [CANARY_DEFAULT_SCOPE]: { ...baseDefault } },
  };

  const assignDefault = (threshold) => {
    const clamped = clampCanaryThreshold(threshold);
    if (clamped == null) {
      return;
    }
    normalized.default.threshold = clamped;
    normalized.scopes[CANARY_DEFAULT_SCOPE] = {
      scope: CANARY_DEFAULT_SCOPE,
      threshold: clamped,
    };
  };

  const assignFeature = (name, threshold) => {
    const clamped = clampCanaryThreshold(threshold);
    if (clamped == null) {
      return;
    }
    const scope = normalizeCanaryScopeKey({ feature: name });
    if (!scope || !scope.startsWith('feature:')) {
      return;
    }
    const segment = scope.slice('feature:'.length);
    const entry = {
      scope,
      threshold: clamped,
      name: typeof name === 'string' && name ? name : segment,
    };
    normalized.features[segment] = entry;
    normalized.scopes[scope] = entry;
  };

  const assignScreen = (name, threshold) => {
    const clamped = clampCanaryThreshold(threshold);
    if (clamped == null) {
      return;
    }
    const scope = normalizeCanaryScopeKey({ screen: name });
    if (!scope || !scope.startsWith('screen:')) {
      return;
    }
    const segment = scope.slice('screen:'.length);
    const entry = {
      scope,
      threshold: clamped,
      name: typeof name === 'string' && name ? name : segment,
    };
    normalized.screens[segment] = entry;
    normalized.scopes[scope] = entry;
  };

  const assignScope = (scopeName, threshold) => {
    const clamped = clampCanaryThreshold(threshold);
    if (clamped == null) {
      return;
    }
    const scope = normalizeCanaryScopeKey(scopeName);
    if (!scope) {
      return;
    }
    if (scope === CANARY_DEFAULT_SCOPE) {
      assignDefault(clamped);
      return;
    }
    if (scope.startsWith('feature:')) {
      assignFeature(scope.slice('feature:'.length), clamped);
      return;
    }
    if (scope.startsWith('screen:')) {
      assignScreen(scope.slice('screen:'.length), clamped);
      return;
    }
    normalized.scopes[scope] = { scope, threshold: clamped };
  };

  const visit = (value) => {
    if (value == null) {
      return;
    }
    if (typeof value === 'number' || typeof value === 'string') {
      assignDefault(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'default')) {
      assignDefault(value.default);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'features')) {
      const features = value.features;
      if (features && typeof features === 'object') {
        for (const [featureName, threshold] of Object.entries(features)) {
          if (threshold && typeof threshold === 'object' && !Array.isArray(threshold)) {
            assignFeature(featureName, threshold.threshold ?? threshold.value ?? threshold.bucket ?? threshold.rollout);
          } else {
            assignFeature(featureName, threshold);
          }
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, 'screens') || Object.prototype.hasOwnProperty.call(value, 'pages')) {
      const screens = value.screens || value.pages;
      if (screens && typeof screens === 'object') {
        for (const [screenName, threshold] of Object.entries(screens)) {
          if (threshold && typeof threshold === 'object' && !Array.isArray(threshold)) {
            assignScreen(screenName, threshold.threshold ?? threshold.value ?? threshold.bucket ?? threshold.rollout);
          } else {
            assignScreen(screenName, threshold);
          }
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, 'scopes')) {
      const scopes = value.scopes;
      if (scopes && typeof scopes === 'object') {
        for (const [scopeName, threshold] of Object.entries(scopes)) {
          if (threshold && typeof threshold === 'object' && !Array.isArray(threshold)) {
            assignScope(scopeName, threshold.threshold ?? threshold.value ?? threshold.bucket ?? threshold.rollout);
          } else {
            assignScope(scopeName, threshold);
          }
        }
      }
    }

    for (const [key, threshold] of Object.entries(value)) {
      if (['default', 'features', 'screens', 'pages', 'scopes'].includes(key)) {
        continue;
      }
      assignScope(key, threshold);
    }
  };

  visit(rawValue);

  return normalized;
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
  const debugMode = detectDebugMode({ legacy, runtime, secureRuntime, globalScope });

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

  const syncedAssignments = syncCanaryAssignments(base.CANARY_ASSIGNMENTS, {
    source: 'runtime-config',
  });
  base.CANARY_ASSIGNMENTS = cloneAssignments(syncedAssignments);
  base.CANARY_ROLLOUTS = normalizeCanaryRollouts(base.CANARY_ROLLOUTS, base.PRECOMPUTED_CANARY_THRESHOLD);

  if (!base.CANARY_ROLLOUTS.scopes[CANARY_DEFAULT_SCOPE]) {
    const defaultEntry = {
      scope: CANARY_DEFAULT_SCOPE,
      threshold: base.PRECOMPUTED_CANARY_THRESHOLD,
    };
    base.CANARY_ROLLOUTS.scopes[CANARY_DEFAULT_SCOPE] = defaultEntry;
    base.CANARY_ROLLOUTS.default = defaultEntry;
  }

  emitRuntimeDebugLog({ debugMode, legacy, runtime, secureRuntime });

  return base;
}

export { DEFAULT_CONFIG };
