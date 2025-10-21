(function () {
  const global = window;
  const runtime = (global.__RUNTIME_CONFIG__ && typeof global.__RUNTIME_CONFIG__ === 'object')
    ? global.__RUNTIME_CONFIG__
    : {};
  const secureConfig = (global.__SECURE_RUNTIME_CONFIG__ && typeof global.__SECURE_RUNTIME_CONFIG__ === 'object')
    ? global.__SECURE_RUNTIME_CONFIG__
    : null;

  if (!Object.prototype.hasOwnProperty.call(runtime, '__loadedAt')) {
    runtime.__loadedAt = new Date().toISOString();
  }

  // Controla cómo actúa el fetch guard: `enforce` (por defecto) o `report-only`.
  // El backend puede sobrescribir este valor mediante configuración segura.
  const defaultGuardMode = 'enforce';
  const secureGuardMode = (secureConfig && typeof secureConfig.FETCH_GUARD_MODE === 'string')
    ? secureConfig.FETCH_GUARD_MODE
    : null;
  const runtimeGuardMode = (typeof runtime.FETCH_GUARD_MODE === 'string')
    ? runtime.FETCH_GUARD_MODE
    : null;
  const FETCH_GUARD_MODE = secureGuardMode || runtimeGuardMode || defaultGuardMode;

  const normalizeUrl = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.replace(/\/$/, '') : null;
  };

  const normalizeLang = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  };

  const parseFlagEntries = (value) => {
    const result = {};
    const assign = (key, raw) => {
      if (key == null) {
        return;
      }
      const name = String(key).trim();
      if (!name) {
        return;
      }

      if (raw === undefined) {
        result[name] = true;
        return;
      }

      if (typeof raw === 'boolean' || raw === null) {
        result[name] = raw;
        return;
      }

      if (typeof raw === 'number') {
        if (!Number.isNaN(raw)) {
          result[name] = raw;
        }
        return;
      }

      if (typeof raw === 'string') {
        const normalized = raw.trim();
        if (!normalized) {
          result[name] = true;
          return;
        }
        const lowered = normalized.toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(lowered)) {
          result[name] = true;
          return;
        }
        if (['0', 'false', 'no', 'off'].includes(lowered)) {
          result[name] = false;
          return;
        }
        result[name] = normalized;
        return;
      }

      if (typeof raw === 'object') {
        result[name] = raw;
        return;
      }
    };

    const visit = (entry) => {
      if (entry == null) {
        return;
      }

      if (Array.isArray(entry)) {
        entry.forEach(visit);
        return;
      }

      if (typeof entry === 'object') {
        for (const [flagName, flagValue] of Object.entries(entry)) {
          assign(flagName, flagValue);
        }
        return;
      }

      if (typeof entry === 'string') {
        const parts = entry.split(',');
        for (const part of parts) {
          const segment = part.trim();
          if (!segment) {
            continue;
          }
          const [flagName, flagValue] = segment.split('=');
          assign(flagName, flagValue === undefined ? true : flagValue);
        }
        return;
      }

      assign(entry, true);
    };

    visit(value);
    return result;
  };

  const fallbackApiBaseUrl = '/api';
  const inferredApiBaseUrl = (() => {
    if (global && typeof global.location === 'object' && global.location && typeof global.location.origin === 'string') {
      const origin = String(global.location.origin || '').trim();
      if (origin) {
        return `${origin.replace(/\/$/, '')}${fallbackApiBaseUrl}`;
      }
    }
    return fallbackApiBaseUrl;
  })();
  const defaultApiBaseUrl = normalizeUrl(inferredApiBaseUrl) || fallbackApiBaseUrl;
  const secureApiBaseUrl = normalizeUrl(secureConfig && secureConfig.API_BASE_URL);
  const runtimeApiBaseUrl = normalizeUrl(runtime.API_BASE_URL);
  const API_BASE_URL = secureApiBaseUrl || runtimeApiBaseUrl || defaultApiBaseUrl;

  const resolveLang = () => {
    const secureLang = normalizeLang(
      secureConfig && (secureConfig.LANG || secureConfig.DEFAULT_LANG),
    );
    if (secureLang) {
      return secureLang;
    }

    const runtimeLang = normalizeLang(runtime.LANG) || normalizeLang(runtime.DEFAULT_LANG);
    if (runtimeLang) {
      return runtimeLang;
    }

    if (global && global.document && global.document.documentElement) {
      const docLang = normalizeLang(global.document.documentElement.lang);
      if (docLang) {
        return docLang;
      }
    }

    if (global && global.navigator && typeof global.navigator.language === 'string') {
      const navigatorLang = normalizeLang(global.navigator.language);
      if (navigatorLang) {
        return navigatorLang;
      }
    }

    return 'es';
  };

  const LANG = resolveLang();

  const runtimeFlags = parseFlagEntries(runtime.FLAGS);
  const secureFlags = parseFlagEntries(secureConfig && secureConfig.FLAGS);
  const FLAGS = Object.assign({}, runtimeFlags, secureFlags);

  const inferredCdnBaseUrl = (() => {
    if (global && typeof global.location === 'object' && global.location && typeof global.location.origin === 'string') {
      const origin = String(global.location.origin || '').trim();
      if (origin) {
        return origin.replace(/\/$/, '');
      }
    }
    return null;
  })();
  const secureCdnBaseUrl = normalizeUrl(secureConfig && secureConfig.CDN_BASE_URL);
  const runtimeCdnBaseUrl = normalizeUrl(runtime.CDN_BASE_URL);
  const defaultCdnBaseUrl = normalizeUrl(inferredCdnBaseUrl);
  const CDN_BASE_URL = secureCdnBaseUrl || runtimeCdnBaseUrl || defaultCdnBaseUrl || null;

  // Para añadir dependencias adicionales (Sentry, APM, CDN, etc.),
  // agrega sus dominios completos en esta lista o sobrescribe
  // `FETCH_GUARD_WHITELIST` desde el backend según sea necesario.
  const DEFAULT_FETCH_GUARD_WHITELIST = [
    'self',
    '/api',
    // Incluye `/recipe-tree` si se requiere para la funcionalidad del árbol de recetas.
    '/recipe-tree',
    'https://www.google-analytics.com',
    'https://region1.google-analytics.com',
    'https://www.googletagmanager.com'
  ];

  const normalizeList = (value) => {
    const entries = [];
    const visit = (item) => {
      if (item == null) return;
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      const text = typeof item === 'string' ? item : String(item);
      const trimmed = text.trim();
      if (trimmed) entries.push(trimmed);
    };

    visit(value);
    return entries;
  };

  const runtimeWhitelist = normalizeList(runtime.FETCH_GUARD_WHITELIST);
  const secureWhitelist = normalizeList(secureConfig && secureConfig.FETCH_GUARD_WHITELIST);

  const buildWhitelist = () => {
    if (secureWhitelist.length > 0) {
      return Array.from(new Set(secureWhitelist));
    }
    const merged = new Set(DEFAULT_FETCH_GUARD_WHITELIST);
    runtimeWhitelist.forEach((entry) => merged.add(entry));
    if (CDN_BASE_URL) {
      merged.add(CDN_BASE_URL);
    }
    return Array.from(merged);
  };

  const FETCH_GUARD_WHITELIST = buildWhitelist();

  // URL opcional a la que se pueden enviar reportes automáticos.
  // Deja este campo vacío si no se necesita registrar incidencias.
  const FETCH_GUARD_REPORT_URL = null;

  const FEATURE_USE_PRECOMPUTED = Object.prototype.hasOwnProperty.call(runtime, 'FEATURE_USE_PRECOMPUTED')
    ? runtime.FEATURE_USE_PRECOMPUTED
    : false; // El backend puede elevar esta flag sin volver a desplegar el bundle.

  // Este archivo debe servirse con `Cache-Control: no-store` para que los cambios
  // del runtime se reflejen inmediatamente en el cliente.

  global.__RUNTIME_CONFIG__ = Object.assign(
    global.__RUNTIME_CONFIG__ || {},
    runtime,
    {
      API_BASE_URL,
      LANG,
      FLAGS,
      FETCH_GUARD_MODE,
      FETCH_GUARD_WHITELIST,
      FETCH_GUARD_REPORT_URL,
      FEATURE_USE_PRECOMPUTED,
      CDN_BASE_URL
    }
  );
})();
