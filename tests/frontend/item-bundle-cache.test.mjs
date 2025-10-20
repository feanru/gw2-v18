import assert from 'node:assert/strict';

function createResponse({ status = 200, ok = true, body = {}, headers = {}, json } = {}) {
  const jsonFn = typeof json === 'function' ? json : async () => body;
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
    clone() {
      return createResponse({ status, ok, body, headers, json });
    },
    async json() {
      return jsonFn();
    },
  };
}

function createServiceWorkerStub() {
  const listeners = new Map();
  const stub = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(listener);
    },
    async register() {
      return { update() {}, unregister() {} };
    },
    controller: {
      postMessage() {},
    },
  };
  stub.dispatchMessage = (data) => {
    const callbacks = listeners.get('message') || [];
    callbacks.forEach((cb) => {
      try {
        cb({ data });
      } catch (err) {
        // ignore listener errors
      }
    });
  };
  return stub;
}

function setupEnvironment({ featureFlag, fetchHandlers = [], serviceWorker = false } = {}) {
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
    document: Object.prototype.hasOwnProperty.call(globalThis, 'document') ? globalThis.document : undefined,
    navigator: Object.prototype.hasOwnProperty.call(globalThis, 'navigator')
      ? globalThis.navigator
      : undefined,
    alert: Object.prototype.hasOwnProperty.call(globalThis, 'alert') ? globalThis.alert : undefined,
    console: Object.prototype.hasOwnProperty.call(globalThis, 'console') ? globalThis.console : undefined,
  };

  const events = [];
  const runtimeConfig = {
    API_BASE_URL: '/api',
    FEATURE_ITEM_API_ROLLOUT: featureFlag,
    FETCH_GUARD_WHITELIST: [],
  };

  const domListeners = new Map();
  const bodyChildren = [];
  const documentStub = {
    addEventListener(type, listener) {
      if (!domListeners.has(type)) {
        domListeners.set(type, []);
      }
      domListeners.get(type).push(listener);
    },
    createElement(tag) {
      return {
        tagName: String(tag || '').toUpperCase(),
        style: {},
        children: [],
        textContent: '',
        appendChild(child) {
          this.children.push(child);
        },
      };
    },
  };
  documentStub.body = {
    children: bodyChildren,
    appendChild(child) {
      bodyChildren.push(child);
    },
  };

  const serviceWorkerStub = serviceWorker ? createServiceWorkerStub() : null;
  const navigatorStub = serviceWorkerStub ? { serviceWorker: serviceWorkerStub } : undefined;

  const consoleEvents = {
    log: [],
    info: [],
    warn: [],
    error: [],
    debug: [],
  };
  const originalConsole = previous.console;
  const consoleStub = Object.create(originalConsole || {});
  ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
    consoleStub[method] = (...args) => {
      if (Array.isArray(consoleEvents[method])) {
        consoleEvents[method].push(args);
      }
      if (originalConsole && typeof originalConsole[method] === 'function') {
        originalConsole[method].apply(originalConsole, args);
      }
    };
  });

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
  globalThis.console = consoleStub;
  globalThis.fetch = async (input, options = {}) => {
    const url = typeof input === 'string'
      ? input
      : (input && typeof input === 'object' && 'url' in input)
        ? input.url
        : String(input);
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
  globalThis.document = documentStub;
  if (navigatorStub) {
    globalThis.navigator = navigatorStub;
  }
  globalThis.alert = () => {};

  return {
    events,
    serviceWorker: serviceWorkerStub,
    console: consoleEvents,
    triggerDOMContentLoaded() {
      const callbacks = domListeners.get('DOMContentLoaded') || [];
      callbacks.forEach((cb) => {
        try {
          cb();
        } catch (err) {
          // ignore listener errors
        }
      });
    },
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
      if (previous.document === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = previous.document;
      }
      if (previous.navigator === undefined) {
        delete globalThis.navigator;
      } else {
        globalThis.navigator = previous.navigator;
      }
      if (previous.alert === undefined) {
        delete globalThis.alert;
      } else {
        globalThis.alert = previous.alert;
      }
      if (previous.console === undefined) {
        delete globalThis.console;
      } else {
        globalThis.console = previous.console;
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
  const fallbackWarningCount = env.console.warn.filter((entry) =>
    typeof entry?.[0] === 'string'
      && entry[0].includes('Fallo en bundle API, usando PHP como fallback')
  ).length;
  assert.ok(fallbackWarningCount >= 1, 'Debe registrar el aviso en consola al activar el fallback');

  const cachedBundles = await module.getItemBundles([90402]);
  assert.equal(apiRequests.length >= 1, true, 'Debe mantener el contador de llamadas iniciales');
  assert.equal(fallbackRequests.length, 1, 'No debe repetir el fallback con cache activo');
  assert.equal(cachedBundles[0]?.item?.name, 'Legacy Bundle 90402');

  env.restore();
}

async function testRequestManagerWarningsAreCaptured() {
  const env = setupEnvironment({
    featureFlag: true,
    fetchHandlers: [
      {
        match(url) {
          return typeof url === 'string' && url.startsWith('/api/items?ids=111');
        },
        response() {
          return createResponse({
            body: '<html>error</html>',
            headers: { 'content-type': 'text/html' },
            json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
          });
        },
      },
      {
        match(url) {
          return typeof url === 'string' && url.startsWith('/api/items/111?lang=es');
        },
        response() {
          return createResponse({
            body: '<html>error</html>',
            headers: { 'content-type': 'text/html' },
            json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
          });
        },
      },
      {
        match(url) {
          return typeof url === 'string'
            && url.startsWith('https://api.guildwars2.com/v2/items/111');
        },
        response() {
          return createResponse({
            body: {
              data: {
                item: { id: 111, name: 'Fallback Item 111', source: 'official-api' },
              },
              meta: { lang: 'es', fallback: 'official-api' },
            },
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        },
      },
    ],
  });

  window.__bundleFallbacks__ = [];

  const module = await import(`../../src/js/utils/requestManager.js?warnings=${Date.now()}`);
  const items = await module.requestItems([111]);

  assert.equal(window.__bundleFallbacks__.length, 0, 'RequestManager no debe tocar los contadores de bundle');
  assert.equal(items[0]?.id, 111, 'El fallback oficial debe resolver el ítem');

  const warningMessages = env.console.warn.map((entry) => entry?.[0] ?? '').join('\n');
  assert.ok(
    warningMessages.includes('[requestManager] official API fallback for item 111: unexpected content-type text/html'),
    'Debe registrar el aviso del fallback oficial',
  );

  if (typeof module.abortRequests === 'function') {
    module.abortRequests();
  }

  env.restore();
}

async function testFetchDedupCoalescesRequests() {
  let fetchCount = 0;
  const env = setupEnvironment({
    featureFlag: true,
    fetchHandlers: [
      {
        match(url) {
          return url === '/api/dedup';
        },
        async response() {
          fetchCount += 1;
          return {
            ok: true,
            status: 200,
            headers: {
              get(name) {
                return name && name.toLowerCase() === 'content-type' ? 'application/json' : null;
              },
            },
            clone() {
              return this;
            },
          };
        },
      },
    ],
  });

  const cacheModule = await import(`../../src/js/utils/cache.js?dedup-${Date.now()}`);

  const [first, second] = await Promise.all([
    cacheModule.fetchDedup('/api/dedup'),
    cacheModule.fetchDedup('/api/dedup'),
  ]);

  assert.equal(fetchCount, 1, 'fetchDedup debe coalescer llamadas concurrentes');
  assert.ok(first, 'Debe retornar una respuesta clonada');
  assert.ok(second, 'Debe retornar una segunda respuesta clonada');

  env.restore();
}

async function testServiceWorkerMetricsTelemetry() {
  const env = setupEnvironment({ featureFlag: true, serviceWorker: true });

  await import(`../../src/js/sw-register.js?metrics-${Date.now()}`);

  env.triggerDOMContentLoaded();

  await Promise.resolve();

  env.serviceWorker.dispatchMessage({
    type: 'cache-metrics',
    metrics: { hit: 2, miss: 1, stale: 1, lastUpdated: 1234 },
  });

  assert.deepEqual(window.__cacheMetrics__, { hit: 2, miss: 1, stale: 1, lastUpdated: 1234 });
  const lastEvent = env.events.at(-1);
  assert.equal(lastEvent?.type, 'cache-metrics', 'Debe despachar un CustomEvent con las métricas');
  assert.deepEqual(lastEvent?.detail, window.__cacheMetrics__);

  env.restore();
}

async function run() {
  await testCachesUpdatedAfterModernBundleSuccess();
  await testFallbackCachesAndTelemetryWhenModernFails();
  await testRequestManagerWarningsAreCaptured();
  await testFetchDedupCoalescesRequests();
  await testServiceWorkerMetricsTelemetry();
  console.log('tests/frontend/item-bundle-cache.test.mjs passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

