import assert from 'node:assert/strict';

function createStubElement(tagName = 'div', id = null) {
  let text = '';
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    id,
    innerHTML: '',
    className: '',
    style: {},
    children: [],
    dataset: {},
    classList: {
      add() {},
      remove() {},
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    set textContent(value) {
      text = String(value ?? '');
      this.innerHTML = text;
    },
    get textContent() {
      return text;
    },
  };
  return element;
}

function createDocumentStub() {
  const elements = new Map();
  const ensureElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createStubElement('div', id));
    }
    return elements.get(id);
  };

  return {
    createElement(tag) {
      return createStubElement(tag);
    },
    getElementById(id) {
      return ensureElement(id);
    },
  };
}

async function testSkipsAggregateWhenFlagDisabled() {
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window') ? globalThis.window : undefined,
    document: Object.prototype.hasOwnProperty.call(globalThis, 'document') ? globalThis.document : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch') ? globalThis.fetch : undefined,
    self: Object.prototype.hasOwnProperty.call(globalThis, 'self') ? globalThis.self : undefined,
  };

  const documentStub = createDocumentStub();
  const donesSkeleton = documentStub.getElementById('dones-skeleton');
  const donesContent = documentStub.getElementById('dones-content');
  const errorMessage = documentStub.getElementById('error-message');
  donesSkeleton.classList = donesSkeleton.classList || { add() {}, remove() {} };
  donesContent.classList = donesContent.classList || { add() {}, remove() {} };
  errorMessage.classList = errorMessage.classList || { add() {}, remove() {} };

  const windowStub = {
    document: documentStub,
    location: { search: '' },
    Config: { FEATURE_DONES_AGGREGATE: false },
    LegendaryData: { LEGENDARY_ITEMS: {}, LEGENDARY_ITEMS_3GEN: {} },
    RecipeService: {},
    __donesAggregateFallbacks__: [],
    addEventListener() {},
    removeEventListener() {},
    performance: { now: () => 0 },
  };
  windowStub.window = windowStub;
  windowStub.self = windowStub;

  globalThis.window = windowStub;
  globalThis.self = windowStub;
  globalThis.document = documentStub;
  globalThis.navigator = globalThis.navigator || { userAgent: 'node-test' };

  let aggregateFetchCalls = 0;
  globalThis.fetch = async (url) => {
    const urlString = String(url);
    if (urlString.includes('/api/aggregate/bundle')) {
      aggregateFetchCalls += 1;
    }
    return {
      ok: true,
      headers: { get() { return null; } },
      async json() { return {}; },
      async text() { return ''; },
      clone() { return this; },
    };
  };

  let resetFeatureFlags;
  try {
    const featureFlagsModule = await import('../../src/js/utils/featureFlags.js');
    resetFeatureFlags = featureFlagsModule.resetFeatureFlags;
    resetFeatureFlags?.();

    await import(`../../src/js/dones.js?test=${Date.now()}`);

    windowStub.RecipeService = {
      async getItemBundles(ids) {
        return ids.map((value) => {
          const id = Number(value);
          return {
            item: { id, name: `Item ${id}` },
            market: { buy_price: 111, sell_price: 222 },
          };
        });
      },
    };

    assert.ok(windowStub.DonesPages, 'DonesPages debe estar expuesto en window');
    await windowStub.DonesPages.loadSpecialDons();

    assert.equal(aggregateFetchCalls, 0, 'No debe consultar /api/aggregate/bundle cuando el flag está deshabilitado');

    const fallbacks = Array.isArray(windowStub.__donesAggregateFallbacks__)
      ? windowStub.__donesAggregateFallbacks__
      : [];
    const hasFlagDisabledFallback = fallbacks.some((entry) => entry?.reason === 'flag-disabled');
    assert.equal(hasFlagDisabledFallback, true, 'Debe registrar un fallback flag-disabled');
  } finally {
    if (typeof resetFeatureFlags === 'function') {
      resetFeatureFlags();
    }
    if (previous.window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previous.window;
    }
    if (previous.self === undefined) {
      delete globalThis.self;
    } else {
      globalThis.self = previous.self;
    }
    if (previous.document === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previous.document;
    }
    if (previous.fetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previous.fetch;
    }
  }
}

async function run() {
  await testSkipsAggregateWhenFlagDisabled();
  console.log('tests/frontend/dones-feature-flag.test.mjs passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
