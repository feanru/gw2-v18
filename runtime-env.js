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
    return Array.from(merged);
  };

  const FETCH_GUARD_WHITELIST = buildWhitelist();

  // URL opcional a la que se pueden enviar reportes automáticos.
  // Deja este campo vacío si no se necesita registrar incidencias.
  const FETCH_GUARD_REPORT_URL = null;

  const FEATURE_USE_PRECOMPUTED = Object.prototype.hasOwnProperty.call(runtime, 'FEATURE_USE_PRECOMPUTED')
    ? runtime.FEATURE_USE_PRECOMPUTED
    : false; // El backend puede elevar esta flag sin volver a desplegar el bundle.

  const FEATURE_ITEM_API_ROLLOUT = (() => {
    if (secureConfig && Object.prototype.hasOwnProperty.call(secureConfig, 'FEATURE_ITEM_API_ROLLOUT')) {
      return secureConfig.FEATURE_ITEM_API_ROLLOUT;
    }
    if (Object.prototype.hasOwnProperty.call(runtime, 'FEATURE_ITEM_API_ROLLOUT')) {
      return runtime.FEATURE_ITEM_API_ROLLOUT;
    }
    return true;
  })();

  // Este archivo debe servirse con `Cache-Control: no-store` para que los cambios
  // del runtime se reflejen inmediatamente en el cliente.

  global.__RUNTIME_CONFIG__ = Object.assign(
    global.__RUNTIME_CONFIG__ || {},
    runtime,
    {
      FETCH_GUARD_MODE,
      FETCH_GUARD_WHITELIST,
      FETCH_GUARD_REPORT_URL,
      FEATURE_USE_PRECOMPUTED,
      FEATURE_ITEM_API_ROLLOUT
    }
  );
})();
