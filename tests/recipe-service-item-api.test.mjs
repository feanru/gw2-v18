import assert from 'node:assert/strict';

function createResponse({ status = 200, ok = true, body = {}, headers = {} } = {}) {
  return {
    status,
    ok,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === String(name).toLowerCase());
        if (key) return headers[key];
        if (String(name).toLowerCase() === 'content-type') return 'application/json';
        return null;
      }
    },
    async json() {
      return body;
    }
  };
}

function setupEnvironment({ featureFlag, fetchHandlers = [] }) {
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window') ? globalThis.window : undefined,
    CustomEvent: Object.prototype.hasOwnProperty.call(globalThis, 'CustomEvent') ? globalThis.CustomEvent : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch') ? globalThis.fetch : undefined,
    localStorage: Object.prototype.hasOwnProperty.call(globalThis, 'localStorage') ? globalThis.localStorage : undefined,
    sessionStorage: Object.prototype.hasOwnProperty.call(globalThis, 'sessionStorage') ? globalThis.sessionStorage : undefined,
    runtimeConfig: Object.prototype.hasOwnProperty.call(globalThis, '__RUNTIME_CONFIG__') ? globalThis.__RUNTIME_CONFIG__ : undefined
  };

  const events = [];
  const runtimeConfig = {
    API_BASE_URL: '/api',
    FEATURE_ITEM_API_ROLLOUT: featureFlag,
    FETCH_GUARD_WHITELIST: []
  };

  const windowStub = {
    dispatchEvent(evt) {
      events.push(evt);
    },
    __RUNTIME_CONFIG__: runtimeConfig
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
    }
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
    }
  };
}

async function testUsesPhpEndpointWhenFlagDisabled() {
  const fetchCalls = [];
  const env = setupEnvironment({
    featureFlag: false,
    fetchHandlers: [
      {
        match(url) {
          fetchCalls.push(url);
          return url.startsWith('/backend/api/dataBundle.php');
        },
        response() {
          return createResponse({
            body: {
              data: [
                { id: 101, item: { id: 101, name: 'Item 101' }, recipe: null, market: null }
              ],
              meta: {}
            }
          });
        }
      }
    ]
  });

  const module = await import(`../src/js/services/recipeService.js?test-legacy=${Date.now()}`);
  const bundles = await module.getItemBundles([101]);

  assert.equal(fetchCalls.length, 1, 'Debe llamarse sólo al endpoint PHP');
  assert.ok(fetchCalls[0].startsWith('/backend/api/dataBundle.php'), 'La URL debe ser la ruta PHP');
  assert.equal(bundles.length, 1, 'Debe devolverse un resultado');
  assert.equal(bundles[0]?.item?.name, 'Item 101', 'El ítem debe provenir del payload PHP');

  env.restore();
}

async function testUsesModernEndpointWhenFlagEnabled() {
  const fetchCalls = [];
  const env = setupEnvironment({
    featureFlag: true,
    fetchHandlers: [
      {
        match(url) {
          fetchCalls.push(url);
          return url.startsWith('/api/items/bundle');
        },
        response() {
          return createResponse({
            body: {
              data: [
                { id: 202, item: { id: 202, name: 'Item 202' }, recipe: null, market: null }
              ],
              meta: {}
            }
          });
        }
      }
    ]
  });

  const module = await import(`../src/js/services/recipeService.js?test-modern=${Date.now()}`);
  const bundles = await module.getItemBundles([202]);

  assert.equal(fetchCalls.length, 1, 'Sólo debe llamarse al endpoint moderno');
  assert.ok(fetchCalls[0].startsWith('/api/items/bundle'), 'La URL debe apuntar al endpoint moderno');
  assert.equal(bundles[0]?.item?.name, 'Item 202', 'Los datos deben provenir de la API moderna');

  env.restore();
}

async function testFallsBackToPhpWhenModernFails() {
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
          return createResponse({ status: 500, ok: false, body: { error: 'boom' } });
        }
      },
      {
        match(url) {
          if (url.startsWith('/backend/api/dataBundle.php')) {
            fetchCalls.push(url);
            return true;
          }
          return false;
        },
        response() {
          return createResponse({
            body: {
              data: [
                { id: 303, item: { id: 303, name: 'Item 303' }, recipe: null, market: null }
              ],
              meta: {}
            }
          });
        }
      }
    ]
  });

  const module = await import(`../src/js/services/recipeService.js?test-fallback=${Date.now()}`);
  const bundles = await module.getItemBundles([303]);

  assert.equal(fetchCalls.length, 2, 'Debe intentarse la API moderna y después la ruta PHP');
  assert.ok(fetchCalls[0].startsWith('/api/items/bundle'), 'La primera llamada debe ser al endpoint moderno');
  assert.ok(fetchCalls[1].startsWith('/backend/api/dataBundle.php'), 'La segunda llamada debe usar la ruta PHP');
  assert.equal(bundles[0]?.item?.name, 'Item 303', 'Los datos deben provenir del fallback PHP');

  env.restore();
}

async function run() {
  await testUsesPhpEndpointWhenFlagDisabled();
  await testUsesModernEndpointWhenFlagEnabled();
  await testFallsBackToPhpWhenModernFails();
  console.log('recipe service item API tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
