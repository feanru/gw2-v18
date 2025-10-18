import { getConfig } from './config.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null;
const GUARD_FLAG = '__GW2_FETCH_GUARD_INSTALLED__';

if (globalScope && typeof globalScope.fetch === 'function' && !globalScope[GUARD_FLAG]) {
  const originalFetch = globalScope.fetch;
  let baseForRelative = resolveLocationOrigin(globalScope) || 'http://localhost';

  const computeGuardState = () => {
    const locationOrigin = resolveLocationOrigin(globalScope);
    if (locationOrigin && baseForRelative !== locationOrigin) {
      baseForRelative = locationOrigin;
    }

    const config = safeGetConfig();
    const mode = normalizeMode(config?.FETCH_GUARD_MODE);
    const reportUrl = normalizeReportUrl(config?.FETCH_GUARD_REPORT_URL);
    const whitelist = buildWhitelist(config, locationOrigin);

    return { mode, reportUrl, whitelist, locationOrigin };
  };

  const emitWarning = (reason, targetUrl, state) => {
    if (state.mode === 'off') return;

    const message = `[fetchGuard] ${reason}: ${targetUrl}`;
    try {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(message);
      }
    } catch {
      /* ignore console errors */
    }

    if (!state.reportUrl) {
      return;
    }

    let payloadString;
    try {
      payloadString = JSON.stringify({
        source: 'fetchGuard',
        reason,
        targetUrl,
        mode: state.mode,
        timestamp: Date.now(),
        locationOrigin: state.locationOrigin,
      });
    } catch {
      payloadString = null;
    }

    if (!payloadString) {
      return;
    }

    try {
      if (typeof globalScope.navigator?.sendBeacon === 'function') {
        globalScope.navigator.sendBeacon(state.reportUrl, payloadString);
        return;
      }
    } catch {
      /* ignore sendBeacon issues */
    }

    try {
      if (typeof globalScope.Image === 'function') {
        const encodedPayload = encodeURIComponent(payloadString);
        const imageUrl = buildReportUrl(state.reportUrl, encodedPayload, baseForRelative);
        if (!imageUrl) return;

        const image = new globalScope.Image();
        try {
          if ('referrerPolicy' in image) {
            image.referrerPolicy = 'no-referrer';
          }
        } catch {
          /* ignore referrerPolicy issues */
        }

        const store = ensureImageStore(globalScope);
        store.add(image);
        const cleanup = () => store.delete(image);
        try {
          image.onload = cleanup;
          image.onerror = cleanup;
        } catch {
          /* ignore handler assignment issues */
        }
        image.src = imageUrl;
      }
    } catch {
      /* ignore image fallback issues */
    }
  };

  const guardedFetch = function fetchGuard(input, init) {
    const state = computeGuardState();
    const targetUrl = toURL(input, baseForRelative);

    if (!targetUrl || state.mode === 'off' || isWhitelisted(targetUrl, state.whitelist)) {
      return originalFetch.call(this, input, init);
    }

    let reason;
    if (isLegacyBackend(targetUrl)) {
      reason = 'Legacy backend fetch detected';
    } else if (isUnexpectedExternal(targetUrl, state.locationOrigin)) {
      reason = 'External fetch detected';
    } else {
      reason = 'Blocked fetch detected';
    }

    const targetDisplay = describeTarget(targetUrl, input);
    emitWarning(reason, targetDisplay, state);

    if (state.mode === 'enforce') {
      return Promise.reject(createGuardError(reason, targetDisplay));
    }

    return originalFetch.call(this, input, init);
  };

  guardedFetch.originalFetch = originalFetch;
  globalScope.fetch = guardedFetch;
  globalScope[GUARD_FLAG] = true;
}

function safeGetConfig() {
  try {
    return getConfig();
  } catch {
    return null;
  }
}

function resolveLocationOrigin(scope) {
  if (!scope || typeof scope !== 'object') {
    return undefined;
  }

  const location = scope.location && typeof scope.location === 'object'
    ? scope.location
    : null;

  const directOrigin = normalizeOrigin(location?.origin);
  if (directOrigin) {
    return directOrigin;
  }

  const scopeOrigin = normalizeOrigin(scope.origin);
  const hrefOrigin = deriveOriginFromHref(location?.href, scopeOrigin);
  if (hrefOrigin) {
    return hrefOrigin;
  }

  if (scopeOrigin) {
    return scopeOrigin;
  }

  return undefined;
}

function deriveOriginFromHref(href, baseOrigin) {
  if (typeof href !== 'string') {
    return null;
  }

  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return normalizeOrigin(url.origin);
  } catch {
    if (!baseOrigin) {
      return null;
    }
    try {
      const url = new URL(trimmed, baseOrigin);
      return normalizeOrigin(url.origin);
    } catch {
      return null;
    }
  }
}

function normalizeOrigin(origin) {
  if (typeof origin !== 'string') {
    return null;
  }

  const trimmed = origin.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return null;
  }

  return trimmed;
}

function buildWhitelist(config, locationOrigin) {
  const entries = new Set();
  const storeEntry = (normalized) => {
    if (!normalized) return;
    if (Array.isArray(normalized)) {
      normalized.forEach(storeEntry);
      return;
    }
    entries.add(normalized);
  };
  const addEntry = (value) => {
    if (!value && value !== 0) return;
    if (Array.isArray(value)) {
      value.forEach(addEntry);
      return;
    }
    if (typeof value === 'string') {
      value.split(',').forEach((part) => {
        const normalized = normalizeWhitelistEntry(part.trim(), locationOrigin);
        storeEntry(normalized);
      });
      return;
    }
    try {
      const normalized = normalizeWhitelistEntry(String(value), locationOrigin);
      storeEntry(normalized);
    } catch {
      /* ignore conversion issues */
    }
  };

  const defaultWhitelist = [
    config?.API_BASE_URL,
    config?.MARKET_CSV_URL,
    '/api',
    'api',
    '/backend/api',
    'backend/api',
    '/recipe-tree',
    'https://api.guildwars2.com',
    'https://api.datawars2.ie'
  ];

  const runtimeWhitelist = config?.FETCH_GUARD_WHITELIST;
  const hasRuntimeWhitelistEntries = hasWhitelistEntries(runtimeWhitelist);

  addEntry(defaultWhitelist);
  addEntry(runtimeWhitelist);
  addEntry(config?.fetchGuardWhitelist);
  addEntry(config?.fetchWhitelist);
  addEntry(config?.FETCH_WHITELIST);

  if (!hasRuntimeWhitelistEntries) {
    addEntry(config?.CONNECT_ALLOWLIST);
  }

  return Array.from(entries);
}

function hasWhitelistEntries(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.split(',').some((part) => part.trim());
  }
  return true;
}

function normalizeWhitelistEntry(entry, locationOrigin) {
  if (!entry) return null;
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const value = trimmed.replace(/^['"]|['"]$/g, '');
  if (!value) return null;

  const lowered = value.toLowerCase();

  if (lowered === 'self') {
    const normalizedOrigin = normalizeOrigin(locationOrigin);
    if (normalizedOrigin) {
      return { type: 'origin', value: normalizedOrigin };
    }
    return { type: 'pathname', value: '/recipe-tree' };
  }

  if (lowered === '*') return { type: 'wildcard' };

  if (/^\*\.[^*]+/.test(value)) {
    const suffix = value.slice(2).toLowerCase();
    if (!suffix) return null;
    return { type: 'hostname-pattern', value: suffix };
  }

  if (value.startsWith('//')) {
    try {
      const url = new URL(value, locationOrigin || 'http:');
      return { type: 'origin', value: url.origin };
    } catch {
      return null;
    }
  }

  if (/^[a-zA-Z]+:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if (value.endsWith('/')) {
        return { type: 'href', value: url.href };
      }
      return { type: 'href', value: url.href };
    } catch {
      return null;
    }
  }

  if (value.startsWith('/')) {
    return { type: 'pathname', value };
  }

  if (value.includes('://')) {
    try {
      const url = new URL(value);
      return { type: 'href', value: url.href };
    } catch {
      return null;
    }
  }

  if (value.includes('.')) {
    return { type: 'hostname', value: value.toLowerCase() };
  }

  return { type: 'pathname', value: value.startsWith('/') ? value : `/${value}` };
}

function toURL(input, base) {
  if (!input && input !== '') return null;

  const tryCreate = (value) => {
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  };

  if (typeof URL !== 'undefined') {
    try {
      if (input instanceof URL) {
        return input;
      }
    } catch {
      /* ignore instanceof issues */
    }
  }

  if (typeof Request !== 'undefined') {
    try {
      if (input instanceof Request) {
        return tryCreate(input.url);
      }
    } catch {
      /* ignore instanceof issues */
    }
  }

  if (typeof input === 'string') {
    return tryCreate(input);
  }

  if (input && typeof input.url === 'string') {
    return tryCreate(input.url);
  }

  return null;
}

function isWhitelisted(url, whitelist) {
  if (!url) return false;
  const hostname = typeof url.hostname === 'string' ? url.hostname.toLowerCase() : '';
  const origin = typeof url.origin === 'string' ? url.origin : '';
  let originHostname = '';
  if (origin && origin !== 'null') {
    try {
      originHostname = new URL(origin).hostname.toLowerCase();
    } catch {
      const normalizedOrigin = origin.toLowerCase();
      const separatorIndex = normalizedOrigin.indexOf('://');
      originHostname = separatorIndex >= 0
        ? normalizedOrigin.slice(separatorIndex + 3)
        : normalizedOrigin;
    }
  }
  for (const entry of whitelist) {
    switch (entry.type) {
      case 'wildcard':
        return true;
      case 'origin':
        if (url.origin === entry.value) return true;
        break;
      case 'href':
        if (url.href.startsWith(entry.value)) return true;
        break;
      case 'hostname':
        if (hostname === entry.value) return true;
        if (originHostname && originHostname === entry.value) return true;
        break;
      case 'hostname-pattern':
        if (matchesHostnameSuffix(hostname, entry.value)) return true;
        if (matchesHostnameSuffix(originHostname, entry.value)) return true;
        break;
      case 'pathname':
        if (url.pathname.startsWith(entry.value)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

function matchesHostnameSuffix(target, suffix) {
  if (!target || !suffix) return false;
  const normalizedTarget = target.toLowerCase();
  const normalizedSuffix = suffix.toLowerCase().replace(/^\.+/, '');
  if (!normalizedSuffix) return false;
  if (normalizedTarget === normalizedSuffix) return true;
  return normalizedTarget.endsWith(`.${normalizedSuffix}`);
}

function isLegacyBackend(url) {
  return url?.pathname.includes('/backend/');
}

function isUnexpectedExternal(url, locationOrigin) {
  if (!url) return false;
  if (!locationOrigin) return false;
  if (url.origin === 'null') return false;
  return url.origin !== locationOrigin;
}

function normalizeMode(value) {
  if (typeof value !== 'string') {
    return 'off';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'off';
  const sanitized = normalized.replace(/[_\s]+/g, '-');

  if (['off', 'disabled', 'disable', 'none', '0', 'false'].includes(sanitized)) {
    return 'off';
  }

  if (['enforce', 'block', 'blocked', 'deny', 'enforced', 'strict', 'on', 'true'].includes(sanitized)) {
    return 'enforce';
  }

  if (['report-only', 'report', 'monitor', 'monitoring', 'warn', 'warning'].includes(sanitized)) {
    return 'report-only';
  }

  return 'off';
}

function normalizeReportUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildReportUrl(reportUrl, encodedPayload, baseForRelative) {
  if (!reportUrl) return null;
  try {
    const url = new URL(reportUrl, baseForRelative);
    url.searchParams.append('payload', encodedPayload);
    return url.href;
  } catch {
    try {
      const separator = reportUrl.includes('?') ? '&' : '?';
      return `${reportUrl}${separator}payload=${encodedPayload}`;
    } catch {
      return null;
    }
  }
}

function ensureImageStore(scope) {
  const key = '__FETCH_GUARD_REPORT_IMAGES__';
  if (!scope[key]) {
    try {
      Object.defineProperty(scope, key, {
        value: new Set(),
        configurable: true,
        enumerable: false,
        writable: false,
      });
    } catch {
      scope[key] = new Set();
    }
  }
  return scope[key];
}

function describeTarget(url, originalInput) {
  if (url?.href) {
    return url.href;
  }
  if (typeof originalInput === 'string') {
    return originalInput;
  }
  if (originalInput && typeof originalInput.url === 'string') {
    return originalInput.url;
  }
  return 'unknown target';
}

function createGuardError(reason, targetUrl) {
  const error = new Error(`[fetchGuard] ${reason}: ${targetUrl}`);
  error.name = 'FetchGuardError';
  error.reason = reason;
  error.url = targetUrl;
  return error;
}

export default null;
