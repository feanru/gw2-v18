import assert from 'node:assert/strict';

function createResponse({ status = 200, ok = true, body = {}, headers = {} } = {}) {
  return {
    status,
    ok,
    headers: {
      get(name) {
        const key = Object.keys(headers).find(
          (k) => k.toLowerCase() === String(name).toLowerCase(),
        );
        if (key) return headers[key];
        if (String(name).toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    },
    async json() {
      return body;
    },
  };
}

function setupEnvironment({ featureFlag, fetchHandlers = [] } = {}) {
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window') ? globalThis.window : undefined,
    CustomEvent: Object.prototype.hasOwnProperty.call(globalThis, 'CustomEvent')
      ? globalThis.CustomEvent
      : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch') ? globalThis.fetch : undefined,
    localStorage: Object.prototype.hasOwnProperty.call(globalThis, 'localStorage')
      ? globalThis.localStorage
      : undefined,
    sessionStorage: Object.prototype.hasOwnProperty.call(globalThis, 'sessionStorage')
      ? globalThis.sessionStorage
      : undefined,
    runtimeConfig: Object.prototype.hasOwnProperty.call(globalThis, '__RUNTIME_CONFIG__')
      ? globalThis.__RUNTIME_CONFIG__
      : undefined,
  };

  const events = [];
  const runtimeConfig = {
    API_BASE_URL: '/api',
    FEATURE_ITEM_API_ROLLOUT: featureFlag,
    FETCH_GUARD_WHITELIST: [],
  };

  const windowStub = {
    dispatchEvent(evt) {
      events.push(evt);
    },
    __RUNTIME_CONFIG__: runtimeConfig,
  };

  const storage = new Map();
  const storageStub = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
    key(index) {
      return Array.from(storage.keys())[index] ?? null;
    },
    get length() {
      return storage.size;
    },
  };

  globalThis.window = windowStub;
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.fetch = async (url, options = {}) => {
    for (const handler of fetchHandlers) {
      if (handler.match(url, options)) {
        if (handler.error) throw handler.error;
        return handler.response();
      }
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  globalThis.localStorage = storageStub;
  globalThis.sessionStorage = storageStub;
  globalThis.__RUNTIME_CONFIG__ = runtimeConfig;

  return {
    events,
    restore() {
      if (previous.window === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previous.window;
      }
      if (previous.CustomEvent === undefined) {
        delete globalThis.CustomEvent;
      } else {
        globalThis.CustomEvent = previous.CustomEvent;
      }
      if (previous.fetch === undefined) {
        delete globalThis.fetch;
      } else {
        globalThis.fetch = previous.fetch;
      }
      if (previous.localStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previous.localStorage;
      }
      if (previous.sessionStorage === undefined) {
        delete globalThis.sessionStorage;
      } else {
        globalThis.sessionStorage = previous.sessionStorage;
      }
      if (previous.runtimeConfig === undefined) {
        delete globalThis.__RUNTIME_CONFIG__;
      } else {
        globalThis.__RUNTIME_CONFIG__ = previous.runtimeConfig;
      }
    },
  };
}

async function testCachesUpdatedAfterModernBundleSuccess() {
  const fetchCalls = [];
  const env = setupEnvironment({
    featureFlag: true,
    fetchHandlers: [
      {
        match(url) {
          if (url.startsWith('/api/items/bundle')) {
            fetchCalls.push(url);
            return true;
          }
          return false;
        },
        response() {
          return createResponse({
            body: {
              data: [
                {
                  id: 90401,
                  item: { id: 90401, name: 'Modern Bundle 90401' },
                  market: { buy_price: 11, sell_price: 22 },
                  recipe: null,
                },
              ],
              meta: { source: 'aggregate', stale: false },
            },
          });
        },
      },
    ],
  });

  window.__bundleFallbacks__ = [];

  const module = await import(
    `../../src/js/services/recipeService.js?bundle-success=${Date.now()}`
  );
  const cacheModule = await import('../../src/js/utils/cache.js');

  const bundles = await module.getItemBundles([90401]);

  assert.equal(fetchCalls.length, 1, 'Debe llamar una vez al endpoint moderno');
  assert.equal(bundles[0]?.item?.name, 'Modern Bundle 90401');

  const cached = cacheModule.getCached('bundle_90401');
  assert.ok(cached, 'Debe existir un cache para el bundle');
  assert.equal(cached.item?.id, 90401, 'El cache debe contener el ítem retornado');
  assert.equal(window.__bundleFallbacks__.length, 0, 'No debe registrar fallbacks en éxito');

  const cachedBundles = await module.getItemBundles([90401]);
  assert.equal(fetchCalls.length, 1, 'Debe reutilizar el cache en la segunda llamada');
  assert.equal(cachedBundles[0]?.item?.name, 'Modern Bundle 90401');

  env.restore();
}

async function testFallbackCachesAndTelemetryWhenModernFails() {
  const apiRequests = [];
  const fallbackRequests = [];
  const env = setupEnvironment({
    featureFlag: true,
    fetchHandlers: [
      {
        match(url) {
          if (url.startsWith('/api/items/bundle')) {
            apiRequests.push(url);
            return true;
          }
          return false;
        },
        error: new Error('Modern bundle failed'),
        response() {
          return createResponse({ status: 500, ok: false, body: { error: 'boom' } });
        },
      },
      {
        match(url) {
          if (url.startsWith('/backend/api/dataBundle.php')) {
            fallbackRequests.push(url);
            return true;
          }
          return false;
        },
        response() {
          return createResponse({
            body: {
              data: [
                {
                  id: 90402,
                  item: { id: 90402, name: 'Legacy Bundle 90402' },
                  market: { buy_price: 15, sell_price: 30 },
                },
              ],
              meta: { source: 'legacy', stale: false },
            },
          });
        },
      },
    ],
  });

  window.__bundleFallbacks__ = [];

  const module = await import(
    `../../src/js/services/recipeService.js?bundle-fallback=${Date.now()}`
  );
  const cacheModule = await import('../../src/js/utils/cache.js');

  const bundles = await module.getItemBundles([90402]);

  assert.ok(apiRequests.length >= 1, 'Debe intentar la API moderna al menos una vez');
  assert.equal(fallbackRequests.length, 1, 'Debe ejecutar exactamente un fallback PHP');
  assert.equal(bundles[0]?.item?.name, 'Legacy Bundle 90402');

  const cached = cacheModule.getCached('bundle_90402');
  assert.ok(cached, 'El fallback debe poblar el cache');
  assert.equal(cached.item?.name, 'Legacy Bundle 90402');
  assert.equal(window.__bundleFallbacks__.length, 1, 'Debe registrar el fallback');
  assert.ok(
    window.__bundleFallbacks__[0].ids.includes('90402'),
    'El evento de fallback debe incluir el ID solicitado',
  );

  const cachedBundles = await module.getItemBundles([90402]);
  assert.equal(apiRequests.length >= 1, true, 'Debe mantener el contador de llamadas iniciales');
  assert.equal(fallbackRequests.length, 1, 'No debe repetir el fallback con cache activo');
  assert.equal(cachedBundles[0]?.item?.name, 'Legacy Bundle 90402');

  env.restore();
}

async function run() {
  await testCachesUpdatedAfterModernBundleSuccess();
  await testFallbackCachesAndTelemetryWhenModernFails();
  console.log('tests/frontend/item-bundle-cache.test.mjs passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

