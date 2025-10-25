import assert from 'node:assert/strict';

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...tokens) {
      tokens.forEach((token) => {
        if (token) classes.add(String(token));
      });
    },
    remove(...tokens) {
      tokens.forEach((token) => {
        classes.delete(String(token));
      });
    },
    contains(token) {
      return classes.has(String(token));
    },
    toggle(token, force) {
      if (force === true) {
        classes.add(String(token));
        return true;
      }
      if (force === false) {
        classes.delete(String(token));
        return false;
      }
      if (classes.has(String(token))) {
        classes.delete(String(token));
        return false;
      }
      classes.add(String(token));
      return true;
    },
    toString() {
      return Array.from(classes).join(' ');
    },
  };
}

function createStubElement(tagName = 'div', id = null) {
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    id,
    innerHTML: '',
    className: '',
    style: {},
    children: [],
    dataset: {},
    parentNode: null,
    classList: createClassList(),
    appendChild(child) {
      if (!child) return child;
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      if (child) {
        child.parentNode = null;
      }
    },
    querySelectorAll(selector) {
      const normalized = String(selector || '').trim().toUpperCase();
      if (!normalized) return [];
      return this.children.filter((child) => child.tagName === normalized);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    addEventListener() {},
    removeEventListener() {},
    set textContent(value) {
      this.innerHTML = String(value ?? '');
    },
    get textContent() {
      return this.innerHTML;
    },
  };
  return element;
}

function createDocumentStub(predefinedIds = []) {
  const elements = new Map();
  const ensureElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createStubElement('div', id));
    }
    return elements.get(id);
  };

  predefinedIds.forEach((id) => ensureElement(id));

  return {
    body: createStubElement('body', 'body'),
    createElement(tag) {
      return createStubElement(tag);
    },
    getElementById(id) {
      if (id == null) return null;
      return ensureElement(String(id));
    },
  };
}

function createStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key) {
      if (store.has(key)) {
        return store.get(key);
      }
      return null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function createLegendaryDataStub(log) {
  const tributeComponent = {
    id: 91001,
    name: 'Tributo dracónico',
    components: [
      { id: 91002, name: 'Componente A', count: 1 },
      { id: 91003, name: 'Componente B', count: 2 },
    ],
  };

  const legendaryGift = {
    id: 92001,
    name: 'Don de prueba',
    components: [
      { id: 92002, name: 'Ingrediente legendario', count: 1 },
    ],
  };

  const payload = {
    items: {
      sunrise: {
        id: 80001,
        name: 'Sunrise',
        components: [legendaryGift],
      },
    },
    gen3: {
      aurene: {
        id: 80002,
        name: 'Aurene',
        components: [tributeComponent],
      },
    },
  };

  return {
    get LEGENDARY_ITEMS() {
      log.push({ key: 'LEGENDARY_ITEMS', timestamp: Date.now() });
      return payload.items;
    },
    get LEGENDARY_ITEMS_3GEN() {
      log.push({ key: 'LEGENDARY_ITEMS_3GEN', timestamp: Date.now() });
      return payload.gen3;
    },
  };
}

async function runSequence(name, order) {
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window') ? globalThis.window : undefined,
    self: Object.prototype.hasOwnProperty.call(globalThis, 'self') ? globalThis.self : undefined,
    document: Object.prototype.hasOwnProperty.call(globalThis, 'document') ? globalThis.document : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch') ? globalThis.fetch : undefined,
    navigator: Object.prototype.hasOwnProperty.call(globalThis, 'navigator') ? globalThis.navigator : undefined,
    localStorage: Object.prototype.hasOwnProperty.call(globalThis, 'localStorage') ? globalThis.localStorage : undefined,
    sessionStorage: Object.prototype.hasOwnProperty.call(globalThis, 'sessionStorage') ? globalThis.sessionStorage : undefined,
    setTimeout: Object.prototype.hasOwnProperty.call(globalThis, 'setTimeout') ? globalThis.setTimeout : undefined,
    clearTimeout: Object.prototype.hasOwnProperty.call(globalThis, 'clearTimeout') ? globalThis.clearTimeout : undefined,
    Worker: Object.prototype.hasOwnProperty.call(globalThis, 'Worker') ? globalThis.Worker : undefined,
  };

  const documentStub = createDocumentStub([
    'dones-content',
    'dones-skeleton',
    'error-message',
    'tributo-content',
    'tributo-skeleton',
    'tributo-draconico-content',
    'tributo-draconico-skeleton',
    'dones-1ra-gen-content',
    'dones-1ra-gen-skeleton',
  ]);

  const legendaryAccessLog = [];

  const windowStub = {
    document: documentStub,
    location: { search: '' },
    Config: { FEATURE_DONES_AGGREGATE: false },
    LegendaryData: createLegendaryDataStub(legendaryAccessLog),
    RecipeService: {
      async getItemBundles(ids) {
        const normalized = Array.isArray(ids) ? ids.map((value) => Number(value)) : [];
        return normalized.map((id) => ({
          item: { id, name: `Item ${id}` },
          market: { buy_price: 111, sell_price: 222 },
        }));
      },
    },
    addEventListener() {},
    removeEventListener() {},
    performance: { now: () => 0 },
    DonesCore: { isGiftName: (name) => typeof name === 'string' && name.toLowerCase().startsWith('don de') },
    __donesPreloadLog__: [],
    __GW2_TELEMETRY__: [],
  };
  windowStub.window = windowStub;
  windowStub.self = windowStub;

  globalThis.window = windowStub;
  globalThis.self = windowStub;
  globalThis.document = documentStub;
  globalThis.navigator = { userAgent: 'node-test' };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();

  class StubWorker {
    constructor(url) {
      const href = url && typeof url === 'object' && typeof url.href === 'string'
        ? url.href
        : String(url ?? '');
      this.url = href;
      this.messageHandlers = new Set();
      this.errorHandlers = new Set();
    }

    addEventListener(type, handler) {
      if (type === 'message') {
        this.messageHandlers.add(handler);
      } else if (type === 'error') {
        this.errorHandlers.add(handler);
      }
    }

    removeEventListener(type, handler) {
      if (type === 'message') {
        this.messageHandlers.delete(handler);
      } else if (type === 'error') {
        this.errorHandlers.delete(handler);
      }
    }

    terminate() {
      this.messageHandlers.clear();
      this.errorHandlers.clear();
    }

    async postMessage(payload) {
      try {
        if (this.url.includes('donesWorker')) {
          const itemEntries = payload?.preloadedItems && typeof payload.preloadedItems === 'object'
            ? Object.entries(payload.preloadedItems)
            : [];
          const priceEntries = payload?.preloadedPrices && typeof payload.preloadedPrices === 'object'
            ? Object.entries(payload.preloadedPrices)
            : [];
          const itemMap = new Map(itemEntries.map(([key, value]) => [Number(key), value]));
          const priceMap = new Map(priceEntries.map(([key, value]) => [Number(key), value]));

          const adaptNode = (node) => {
            if (!node || typeof node !== 'object') {
              return null;
            }
            const id = Number(node.id);
            const itemInfo = itemMap.get(id) || {};
            const priceInfo = priceMap.get(id) || {};
            const components = Array.isArray(node.components) ? node.components : [];
            const children = components
              .map((child) => adaptNode(child))
              .filter((child) => child !== null);
            return {
              id: node.id,
              name: node.name ?? itemInfo.name ?? null,
              icon: node.icon ?? itemInfo.icon ?? null,
              rarity: node.rarity ?? itemInfo.rarity ?? null,
              type: node.type ?? itemInfo.type ?? null,
              count: node.count ?? 0,
              buy_price: node.buy_price ?? priceInfo.buy_price ?? null,
              sell_price: node.sell_price ?? priceInfo.sell_price ?? null,
              is_craftable: children.length > 0,
              children,
            };
          };

          const ingredientTree = Array.isArray(payload?.rootIngredients)
            ? payload.rootIngredients.map((entry) => adaptNode(entry)).filter((entry) => entry !== null)
            : [];

          await Promise.resolve();
          this.messageHandlers.forEach((handler) => {
            handler({ data: { ingredientTree } });
          });
        } else if (this.url.includes('costsWorker')) {
          const cloneNode = (node) => {
            if (!node || typeof node !== 'object') {
              return null;
            }
            const children = Array.isArray(node.children)
              ? node.children.map((child) => cloneNode(child)).filter((child) => child !== null)
              : [];
            return { ...node, children };
          };

          const computeTotals = (node) => {
            if (!node) return { buy: 0, sell: 0 };
            let totalBuy = 0;
            let totalSell = 0;
            if (Array.isArray(node.children) && node.children.length > 0) {
              node.children.forEach((child) => {
                const childTotals = computeTotals(child);
                totalBuy += childTotals.buy;
                totalSell += childTotals.sell;
              });
            } else {
              const count = Number.isFinite(node.count) ? node.count : 0;
              const buy = Number.isFinite(node.buy_price) ? node.buy_price : 0;
              const sell = Number.isFinite(node.sell_price) ? node.sell_price : 0;
              totalBuy = buy * count;
              totalSell = sell * count;
            }
            node.total_buy = totalBuy;
            node.total_sell = totalSell;
            return { buy: totalBuy, sell: totalSell };
          };

          const updatedTree = Array.isArray(payload?.ingredientTree)
            ? payload.ingredientTree.map((entry) => cloneNode(entry)).filter((entry) => entry !== null)
            : [];

          let aggregateBuy = 0;
          let aggregateSell = 0;
          updatedTree.forEach((node) => {
            const totals = computeTotals(node);
            aggregateBuy += totals.buy;
            aggregateSell += totals.sell;
          });

          await Promise.resolve();
          this.messageHandlers.forEach((handler) => {
            handler({ data: { updatedTree, totals: { buy: aggregateBuy, sell: aggregateSell } } });
          });
        } else {
          throw new Error(`Worker no soportado: ${this.url}`);
        }
      } catch (error) {
        await Promise.resolve();
        this.errorHandlers.forEach((handler) => handler(error));
      }
    }
  }

  globalThis.Worker = StubWorker;

  const timeoutRegistry = new Set();
  globalThis.setTimeout = (fn, delay, ...args) => {
    const id = previous.setTimeout ? previous.setTimeout(() => fn(...args), delay) : Date.now();
    timeoutRegistry.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    if (previous.clearTimeout) {
      previous.clearTimeout(id);
    }
    timeoutRegistry.delete(id);
  };

  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input ?? '');
    const result = {
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      async text() {
        let ids = [];
        try {
          const parsed = new URL(url, 'https://example.test');
          const rawIds = parsed.searchParams.get('ids');
          ids = rawIds ? rawIds.split(',').filter(Boolean) : [];
        } catch {
          const match = /ids=([^&]+)/.exec(url);
          if (match) {
            ids = match[1].split(',').filter(Boolean);
          }
        }
        const rows = ['id,buy_price,sell_price', ...ids.map((id, index) => `${id},${100 + index},${200 + index}`)];
        return rows.join('\n');
      },
      async json() {
        return {};
      },
      clone() {
        return this;
      },
    };
    return result;
  };

  let resetFeatureFlags;
  try {
    const featureFlagsModule = await import(`../../src/js/utils/featureFlags.js`);
    resetFeatureFlags = featureFlagsModule.resetFeatureFlags;
    resetFeatureFlags?.();

    await import(`../../src/js/dones.js?test=${name}&t=${Date.now()}`);

    const loadMap = {
      special: 'loadSpecialDons',
      tributo: 'loadTributo',
      draconic: 'loadDraconicTribute',
      legendary: 'loadDones1Gen',
    };

    const expectations = {
      loadSpecialDons: { context: 'special', legendary: false },
      loadTributo: { context: 'tributo', legendary: false },
      loadDraconicTribute: { context: 'draconic', legendary: false },
      loadDones1Gen: { context: 'legendary', legendary: true },
    };

    for (const key of order) {
      const fnName = loadMap[key];
      assert.ok(typeof windowStub.DonesPages?.[fnName] === 'function', `Debe exponer ${fnName}`);

      const legendaryBefore = legendaryAccessLog.filter((entry) => entry.key === 'LEGENDARY_ITEMS').length;
      const logBefore = windowStub.__donesPreloadLog__.length;

      await windowStub.DonesPages[fnName]();

      const logDelta = windowStub.__donesPreloadLog__.slice(logBefore).filter((entry) => entry.type === 'fetch');
      assert.ok(logDelta.length >= 1, `Debe haber al menos un fetch para ${fnName}`);
      const expected = expectations[fnName];
      logDelta.forEach((fetchEntry) => {
        assert.equal(fetchEntry.context, expected.context, `El contexto debe ser ${expected.context} para ${fnName}`);
        assert.equal(fetchEntry.legendary, expected.legendary, `La bandera legendary debe ser ${expected.legendary} para ${fnName}`);
        assert.ok(Array.isArray(fetchEntry.ids) && fetchEntry.ids.length > 0, `Debe registrar IDs en el fetch de ${fnName}`);
      });
      const legendaryAfter = legendaryAccessLog.filter((entry) => entry.key === 'LEGENDARY_ITEMS').length;
      if (fnName !== 'loadDones1Gen') {
        assert.equal(legendaryAfter, legendaryBefore, 'No debe acceder a LEGENDARY_ITEMS antes de abrir el tab 4');
      }
    }

    const fetchEntries = windowStub.__donesPreloadLog__.filter((entry) => entry.type === 'fetch');
    const uniqueContexts = new Set(fetchEntries.map((entry) => entry.context));
    ['special', 'tributo', 'draconic', 'legendary'].forEach((context) => {
      assert.ok(uniqueContexts.has(context), `Debe existir al menos un fetch para el contexto ${context}`);
    });
    fetchEntries.forEach((entry) => {
      const expectedLegendary = entry.context === 'legendary';
      assert.equal(entry.legendary, expectedLegendary, 'Sólo el contexto legendario debe marcar legendary = true');
    });

    const legendaryItemAccesses = legendaryAccessLog.filter((entry) => entry.key === 'LEGENDARY_ITEMS');
    assert.ok(legendaryItemAccesses.length > 0, 'Debe acceder a LEGENDARY_ITEMS al abrir el tab legendario');
  } finally {
    if (typeof resetFeatureFlags === 'function') {
      resetFeatureFlags();
    }
    timeoutRegistry.forEach((id) => {
      if (previous.clearTimeout) {
        previous.clearTimeout(id);
      }
    });
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
    if (previous.navigator === undefined) {
      delete globalThis.navigator;
    } else {
      globalThis.navigator = previous.navigator;
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
    if (previous.setTimeout === undefined) {
      delete globalThis.setTimeout;
    } else {
      globalThis.setTimeout = previous.setTimeout;
    }
    if (previous.clearTimeout === undefined) {
      delete globalThis.clearTimeout;
    } else {
      globalThis.clearTimeout = previous.clearTimeout;
    }
    if (previous.Worker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = previous.Worker;
    }
  }
}

async function run() {
  await runSequence('forward', ['special', 'tributo', 'draconic', 'legendary']);
  await runSequence('reverse', ['legendary', 'draconic', 'tributo', 'special']);
  console.log('tests/frontend/dones-preload-context-order.test.mjs passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
