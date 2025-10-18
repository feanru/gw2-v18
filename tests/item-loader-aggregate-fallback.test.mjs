import assert from 'node:assert/strict';
import { resetFeatureFlags } from '../src/js/utils/featureFlags.js';

function createLegacyResponsePayload(itemId) {
  return {
    data: {
      item: {
        id: itemId,
        name: `Item ${itemId}`,
        icon: 'icon.png',
        rarity: 'rare'
      },
      recipe: {
        output_item_count: 2,
        ingredients: [
          { item_id: itemId + 1, count: 3, type: 'Item' },
          { item_id: itemId + 2, count: 1, type: 'Item' }
        ]
      },
      market: {
        buy_price: 111,
        sell_price: 222
      },
      nested_recipe: {
        id: itemId,
        tree: [
          {
            id: itemId + 1000,
            name: `Nested ${itemId}`,
            icon: 'nested.png',
            rarity: 'Masterwork',
            count: 2,
            buy_price: 50,
            sell_price: 60,
            is_craftable: false,
            children: [],
            recipe: {
              output_item_count: 1,
              ingredients: []
            }
          }
        ]
      }
    },
    meta: {}
  };
}

function createMockResponse(payload) {
  return {
    status: payload.status ?? 200,
    ok: payload.ok ?? true,
    headers: {
      get(name) {
        if (name && name.toLowerCase() === 'content-type') {
          return 'application/json';
        }
        return null;
      }
    },
    async json() {
      return payload.body;
    }
  };
}

function createSessionStorageStub() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    }
  };
}

function setupDomEnvironment(tag, options = {}) {
  const { featureItemApiRollout = false } = options;
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window') ? globalThis.window : undefined,
    document: Object.prototype.hasOwnProperty.call(globalThis, 'document') ? globalThis.document : undefined,
    localStorage: Object.prototype.hasOwnProperty.call(globalThis, 'localStorage') ? globalThis.localStorage : undefined,
    sessionStorage: Object.prototype.hasOwnProperty.call(globalThis, 'sessionStorage') ? globalThis.sessionStorage : undefined,
    requestAnimationFrame: Object.prototype.hasOwnProperty.call(globalThis, 'requestAnimationFrame') ? globalThis.requestAnimationFrame : undefined,
    IntersectionObserver: Object.prototype.hasOwnProperty.call(globalThis, 'IntersectionObserver') ? globalThis.IntersectionObserver : undefined,
    CustomEvent: Object.prototype.hasOwnProperty.call(globalThis, 'CustomEvent') ? globalThis.CustomEvent : undefined,
    fetchAggregate: Object.prototype.hasOwnProperty.call(globalThis, '__TEST_FETCH_ITEM_AGGREGATE__') ? globalThis.__TEST_FETCH_ITEM_AGGREGATE__ : undefined,
    fetchLegacy: Object.prototype.hasOwnProperty.call(globalThis, '__TEST_FETCH_WITH_RETRY__') ? globalThis.__TEST_FETCH_WITH_RETRY__ : undefined,
    runtimeConfig: Object.prototype.hasOwnProperty.call(globalThis, '__RUNTIME_CONFIG__') ? globalThis.__RUNTIME_CONFIG__ : undefined,
    aggregateFallbacks: Object.prototype.hasOwnProperty.call(globalThis, '__aggregateFallbacks__') ? globalThis.__aggregateFallbacks__ : undefined,
    gw2Telemetry: Object.prototype.hasOwnProperty.call(globalThis, '__GW2_TELEMETRY__') ? globalThis.__GW2_TELEMETRY__ : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch') ? globalThis.fetch : undefined,
  };

  const skeletonEl = { id: 'item-skeleton' };
  const craftingEl = {};
  const freshnessEl = {
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    className: '',
    innerHTML: '',
    dataset: {}
  };

  const elements = new Map([
    ['item-skeleton', skeletonEl],
    ['seccion-crafting', craftingEl],
    ['freshness-banner', freshnessEl]
  ]);

  const docStub = {
    addEventListener() {},
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll() {
      return [];
    }
  };

  const winStub = {
    location: { search: '' },
    document: docStub,
    hideError() {
      winStub.__lastError = null;
    },
    showError(message) {
      winStub.__lastError = message;
    },
    showSkeleton() {
      winStub.__skeletonShown = true;
    },
    hideSkeleton() {
      winStub.__skeletonHidden = true;
    },
    initItemUI: async () => {
      winStub.__legacyInitCalls += 1;
    },
    safeRenderTable: async () => {},
    StorageUtils: {
      showToast() {}
    },
    RecipeService: {
      getItemBundles: async () => []
    },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {}
  };

  winStub.__legacyInitCalls = 0;
  winStub.__aggregateFallbacks__ = [];
  winStub.__GW2_TELEMETRY__ = [];
  winStub.globalQty = 1;
  winStub._mainBuyPrice = 0;
  winStub._mainSellPrice = 0;
  winStub._mainRecipeOutputCount = 1;

  globalThis.window = winStub;
  globalThis.document = docStub;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'gw2.precomputed.bucket') return '0';
      return null;
    },
    setItem() {},
    removeItem() {},
    clear() {}
  };
  globalThis.sessionStorage = createSessionStorageStub();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {};
    },
    async text() {
      return '';
    },
  });
  const runtimeConfig = {
    FEATURE_USE_PRECOMPUTED: true,
    PRECOMPUTED_CANARY_THRESHOLD: 100,
    FETCH_GUARD_WHITELIST: [],
    FEATURE_ITEM_API_ROLLOUT: featureItemApiRollout
  };
  globalThis.__RUNTIME_CONFIG__ = runtimeConfig;
  winStub.__RUNTIME_CONFIG__ = runtimeConfig;
  globalThis.__aggregateFallbacks__ = winStub.__aggregateFallbacks__;
  globalThis.__GW2_TELEMETRY__ = winStub.__GW2_TELEMETRY__;

  resetFeatureFlags();

  return {
    previous,
    skeletonEl,
    craftingEl,
    freshnessEl,
    teardown() {
      if (previous.window === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previous.window;
      }
      if (previous.document === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = previous.document;
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
      if (previous.requestAnimationFrame === undefined) {
        delete globalThis.requestAnimationFrame;
      } else {
        globalThis.requestAnimationFrame = previous.requestAnimationFrame;
      }
      if (previous.IntersectionObserver === undefined) {
        delete globalThis.IntersectionObserver;
      } else {
        globalThis.IntersectionObserver = previous.IntersectionObserver;
      }
      if (previous.CustomEvent === undefined) {
        delete globalThis.CustomEvent;
      } else {
        globalThis.CustomEvent = previous.CustomEvent;
      }
      if (previous.fetchAggregate === undefined) {
        delete globalThis.__TEST_FETCH_ITEM_AGGREGATE__;
      } else {
        globalThis.__TEST_FETCH_ITEM_AGGREGATE__ = previous.fetchAggregate;
      }
      if (previous.fetchLegacy === undefined) {
        delete globalThis.__TEST_FETCH_WITH_RETRY__;
      } else {
        globalThis.__TEST_FETCH_WITH_RETRY__ = previous.fetchLegacy;
      }
      if (previous.runtimeConfig === undefined) {
        delete globalThis.__RUNTIME_CONFIG__;
      } else {
        globalThis.__RUNTIME_CONFIG__ = previous.runtimeConfig;
      }
      if (previous.aggregateFallbacks === undefined) {
        delete globalThis.__aggregateFallbacks__;
      } else {
        globalThis.__aggregateFallbacks__ = previous.aggregateFallbacks;
      }
      if (previous.gw2Telemetry === undefined) {
        delete globalThis.__GW2_TELEMETRY__;
      } else {
        globalThis.__GW2_TELEMETRY__ = previous.gw2Telemetry;
      }
      if (previous.fetch === undefined) {
        delete globalThis.fetch;
      } else {
        globalThis.fetch = previous.fetch;
      }
    }
  };
}

async function runMissingItemFallbackTest() {
  const env = setupDomEnvironment('missing');
  let aggregateCalls = 0;
  let legacyCalls = 0;
  globalThis.__TEST_FETCH_ITEM_AGGREGATE__ = async () => {
    aggregateCalls += 1;
    return {
      data: { item: null, market: null, tree: null },
      meta: { errors: [] },
      status: 200
    };
  };
  globalThis.__TEST_FETCH_WITH_RETRY__ = async () => {
    legacyCalls += 1;
    return createMockResponse({
      body: createLegacyResponsePayload(123)
    });
  };

  const module = await import(`../src/js/item-loader.js?fallback-missing=${Date.now()}`);
  await module.loadItem(123);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(aggregateCalls, 1, 'Aggregate fetch should run once');
  assert.equal(legacyCalls, 1, 'Legacy fetch should run once after fallback');
  assert.equal(window.__legacyInitCalls, 1, 'Legacy UI initialization should run once');
  assert.ok(Array.isArray(window.__aggregateFallbacks__), 'Fallback telemetry array should exist');
  assert.equal(window.__aggregateFallbacks__.length, 1, 'Fallback telemetry should have one entry');
  assert.equal(window.__aggregateFallbacks__[0].reason, 'missing-item', 'Fallback reason should be missing-item');
  assert.equal(window.__aggregateFallbacks__[0].stale, false, 'Fallback should record stale=false when metadata missing');

  env.teardown();
}

async function runAggregateThrowsFallbackTest() {
  const env = setupDomEnvironment('throws');
  let aggregateCalls = 0;
  let legacyCalls = 0;
  globalThis.__TEST_FETCH_ITEM_AGGREGATE__ = async () => {
    aggregateCalls += 1;
    throw new Error('boom');
  };
  globalThis.__TEST_FETCH_WITH_RETRY__ = async () => {
    legacyCalls += 1;
    return createMockResponse({
      body: createLegacyResponsePayload(456)
    });
  };

  const module = await import(`../src/js/item-loader.js?fallback-throws=${Date.now()}`);
  await module.loadItem(456);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(aggregateCalls, 1, 'Aggregate fetch should run once and fail');
  assert.equal(legacyCalls, 1, 'Legacy fetch should run once after aggregate error');
  assert.equal(window.__legacyInitCalls, 1, 'Legacy UI initialization should run once after error');
  assert.ok(Array.isArray(window.__aggregateFallbacks__), 'Fallback telemetry array should exist');
  assert.equal(window.__aggregateFallbacks__.length, 1, 'Fallback telemetry should record one event');
  assert.equal(window.__aggregateFallbacks__[0].reason, 'aggregate-error', 'Fallback reason should be aggregate-error');
  assert.equal(window.__lastError, null, 'Error banner should be cleared by legacy path');

  env.teardown();
}

async function runLegacyItemApiSuccessTest() {
  const env = setupDomEnvironment('item-api-success', { featureItemApiRollout: true });
  const calls = [];
  globalThis.__TEST_FETCH_WITH_RETRY__ = async (url) => {
    calls.push(url);
    if (url.startsWith('/api/items/')) {
      return createMockResponse({
        body: createLegacyResponsePayload(789)
      });
    }
    throw new Error(`URL inesperada ${url}`);
  };

  const originalInitItemUI = window.initItemUI;
  window.initItemUI = (item, market) => {
    window.__lastInitItem = item;
    window.__lastInitMarket = market;
    return originalInitItemUI(item, market);
  };

  const module = await import(`../src/js/item-loader.js?legacy-api-success=${Date.now()}`);
  await module.loadItem(789, { forceLegacy: true });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1, 'La ruta moderna debe consultarse una vez');
  assert.ok(calls[0].startsWith('/api/items/789'), 'El endpoint moderno debe incluir el ID del ítem');
  assert.equal(window.__legacyInitCalls, 1, 'La UI legacy debe inicializarse con éxito');
  assert.equal(window.__lastError, null, 'No debe mostrarse error con la respuesta moderna');
  assert.strictEqual(window._mainRecipeOutputCount, 2, 'El output de la receta debe provenir del payload moderno');
  assert.strictEqual(window._mainBuyPrice, 111, 'El precio de compra debe actualizarse desde la API moderna');
  assert.strictEqual(window._mainSellPrice, 222, 'El precio de venta debe actualizarse desde la API moderna');
  assert.ok(window.__lastInitItem && window.__lastInitItem.id === 789, 'La UI debe inicializarse con el ítem correcto');
  assert.ok(window.__lastInitMarket && window.__lastInitMarket.buy_price === 111, 'La UI debe recibir los datos de mercado modernos');
  window.initItemUI = originalInitItemUI;

  env.teardown();
}

async function runLegacyItemApiFallbackTest() {
  const env = setupDomEnvironment('item-api-fallback', { featureItemApiRollout: true });
  const calls = [];
  globalThis.__TEST_FETCH_WITH_RETRY__ = async (url) => {
    calls.push(url);
    if (url.startsWith('/api/items/')) {
      return createMockResponse({
        status: 500,
        ok: false,
        body: { error: 'boom' }
      });
    }
    if (url.startsWith('/backend/api/itemDetails.php')) {
      return createMockResponse({
        body: createLegacyResponsePayload(321)
      });
    }
    throw new Error(`URL inesperada ${url}`);
  };

  const module = await import(`../src/js/item-loader.js?legacy-api-fallback=${Date.now()}`);
  await module.loadItem(321, { forceLegacy: true });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 2, 'Debe intentarse la API moderna y luego el fallback PHP');
  assert.ok(calls[0].startsWith('/api/items/321'), 'La primera llamada debe ser a la API moderna');
  assert.ok(calls[1].startsWith('/backend/api/itemDetails.php'), 'La segunda llamada debe ser a la ruta PHP');
  assert.equal(window.__legacyInitCalls, 1, 'El fallback debe inicializar la UI legacy');
  assert.equal(window.__lastError, null, 'El fallback no debe dejar errores visibles');

  env.teardown();
}

async function run() {
  await runMissingItemFallbackTest();
  await runAggregateThrowsFallbackTest();
  await runLegacyItemApiSuccessTest();
  await runLegacyItemApiFallbackTest();
  console.log('item-loader aggregate fallback tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
