import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workerPath = join(__dirname, '../src/js/workers/ingredientTreeWorker.js');

async function loadWorker({ fetchWithCache, configOverrides = {} }) {
  const workerUrl = `${pathToFileURL(workerPath).href}?test=${Date.now()}-${Math.random()}`;
  const previous = {
    self: globalThis.self,
    location: globalThis.location,
    fetch: globalThis.fetch,
    navigator: globalThis.navigator,
    consoleWarn: console.warn,
    config: globalThis.Config,
    runtimeConfig: globalThis.__RUNTIME_CONFIG__,
  };
  const posted = [];
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  const location = { origin: 'https://gw2.test' };
  globalThis.location = location;
  globalThis.fetch = () => { throw new Error('unexpected fetch call'); };
  globalThis.navigator = { sendBeacon: () => true };

  const previousSelfConfig = previous.self && typeof previous.self === 'object'
    ? { config: previous.self.Config, runtime: previous.self.__RUNTIME_CONFIG__ }
    : { config: undefined, runtime: undefined };
  const flagConfig = {
    FEATURE_MARKET_CSV_EXTERNAL: true,
    FEATURE_MARKET_CSV_EXTERNAL_WORKER: false,
    MARKET_CSV_URL: 'https://external.invalid/market.csv',
    ...configOverrides,
  };

  globalThis.self = {
    location,
    postMessage: (msg) => { posted.push(msg); },
    __TEST_OVERRIDES__: { fetchWithCache },
    Config: {
      ...(previousSelfConfig.config || {}),
      ...flagConfig,
    },
    __RUNTIME_CONFIG__: {
      ...(previousSelfConfig.runtime || {}),
      ...flagConfig,
    },
  };
  globalThis.Config = {
    ...(previous.config || {}),
    ...flagConfig,
  };
  globalThis.__RUNTIME_CONFIG__ = {
    ...(previous.runtimeConfig || {}),
    ...flagConfig,
  };

  try {
    await import(workerUrl);
    return { posted, restore: () => {
      if (previous.self === undefined) delete globalThis.self; else globalThis.self = previous.self;
      if (previous.location === undefined) delete globalThis.location; else globalThis.location = previous.location;
      if (previous.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = previous.fetch;
      if (previous.navigator === undefined) delete globalThis.navigator; else globalThis.navigator = previous.navigator;
      if (previous.consoleWarn === undefined) delete console.warn; else console.warn = previous.consoleWarn;
      if (previous.config === undefined) delete globalThis.Config; else globalThis.Config = previous.config;
      if (previous.runtimeConfig === undefined) delete globalThis.__RUNTIME_CONFIG__;
      else globalThis.__RUNTIME_CONFIG__ = previous.runtimeConfig;
      if (typeof globalThis.self === 'object' && globalThis.self) {
        if (previousSelfConfig.config === undefined) delete globalThis.self.Config;
        else globalThis.self.Config = previousSelfConfig.config;
        if (previousSelfConfig.runtime === undefined) delete globalThis.self.__RUNTIME_CONFIG__;
        else globalThis.self.__RUNTIME_CONFIG__ = previousSelfConfig.runtime;
      }
    } };
  } catch (err) {
    if (previous.self === undefined) delete globalThis.self; else globalThis.self = previous.self;
    if (previous.location === undefined) delete globalThis.location; else globalThis.location = previous.location;
    if (previous.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = previous.fetch;
    if (previous.navigator === undefined) delete globalThis.navigator; else globalThis.navigator = previous.navigator;
    if (previous.consoleWarn === undefined) delete console.warn; else console.warn = previous.consoleWarn;
    if (previous.config === undefined) delete globalThis.Config; else globalThis.Config = previous.config;
    if (previous.runtimeConfig === undefined) delete globalThis.__RUNTIME_CONFIG__;
    else globalThis.__RUNTIME_CONFIG__ = previous.runtimeConfig;
    if (typeof globalThis.self === 'object' && globalThis.self) {
      if (previousSelfConfig.config === undefined) delete globalThis.self.Config;
      else globalThis.self.Config = previousSelfConfig.config;
      if (previousSelfConfig.runtime === undefined) delete globalThis.self.__RUNTIME_CONFIG__;
      else globalThis.self.__RUNTIME_CONFIG__ = previousSelfConfig.runtime;
    }
    throw err;
  }
}

async function runGeneration(workerContext, mainItemId, mainRecipeData) {
  await globalThis.self.onmessage({ data: { type: 'runtimeConfig', config: {} } });
  await globalThis.self.onmessage({ data: { type: 'generateTree', mainItemId, mainRecipeData } });
  return workerContext.posted.find((msg) => Object.prototype.hasOwnProperty.call(msg, 'tree'));
}

function createItem(id, name) {
  return {
    id,
    name,
    icon: `${name}.png`,
    rarity: 'Fine',
  };
}

await (async () => {
  const callLog = [];
  const itemsResponse = { data: [createItem(123, 'Root'), createItem(456, 'Leaf')] };
  const csvResponse = 'id,buy_price,sell_price\n123,10,20\n456,30,40';
  const fetchWithCache = async (url) => {
    callLog.push(url);
    if (url.startsWith('/recipe-tree/')) {
      return {
        ok: true,
        json: async () => ({
          id: 123,
          recipe: { output_item_count: 1 },
          components: [
            { type: 'Item', id: 456, quantity: 2 },
          ],
        }),
      };
    }
    if (url.startsWith('/api/items')) {
      return { ok: true, json: async () => itemsResponse };
    }
    if (url.startsWith('/api/market.csv')) {
      return { ok: true, text: async () => csvResponse };
    }
    throw new Error(`Unexpected url ${url}`);
  };

  const context = await loadWorker({ fetchWithCache });
  try {
    const result = await runGeneration(context, 123, { output_item_count: 1, ingredients: [] });
    assert.ok(Array.isArray(result.tree), 'worker should respond with tree array');
    assert.ok(callLog.some((entry) => entry.startsWith('/api/items')), 'should request item details from internal API');
    assert.ok(callLog.some((entry) => entry.startsWith('/api/market.csv')), 'should request market CSV from internal API');
    assert.ok(!callLog.some((entry) => entry.includes('api.guildwars2.com')), 'should not hit external GW2 API');
    assert.ok(!callLog.some((entry) => entry.includes('api.datawars2.ie')), 'should not hit external market API');
    assert.ok(!callLog.some((entry) => entry.includes('external.invalid')), 'should ignore configured external market CSV URL');
  } finally {
    context.restore();
  }
})();

await (async () => {
  const callLog = [];
  const itemsResponse = { data: [createItem(321, 'ExternalRoot'), createItem(654, 'ExternalLeaf')] };
  const csvResponse = 'id,buy_price,sell_price\n321,15,25\n654,35,45';
  const fetchWithCache = async (url) => {
    callLog.push(url);
    if (url.startsWith('/recipe-tree/')) {
      return {
        ok: true,
        json: async () => ({
          id: 321,
          recipe: { output_item_count: 1 },
          components: [
            { type: 'Item', id: 654, quantity: 1 },
          ],
        }),
      };
    }
    if (url.startsWith('/api/items')) {
      return { ok: true, json: async () => itemsResponse };
    }
    if (url.startsWith('https://external.invalid/market.csv')) {
      return { ok: true, text: async () => csvResponse };
    }
    throw new Error(`Unexpected url ${url}`);
  };

  const context = await loadWorker({
    fetchWithCache,
    configOverrides: {
      FEATURE_MARKET_CSV_EXTERNAL: true,
      FEATURE_MARKET_CSV_EXTERNAL_WORKER: true,
    },
  });
  try {
    const result = await runGeneration(context, 321, { output_item_count: 1, ingredients: [] });
    assert.ok(Array.isArray(result.tree), 'worker should respond with tree array when external CSV is enabled');
    assert.ok(callLog.some((entry) => entry.startsWith('https://external.invalid/market.csv')),
      'should request market CSV from configured external domain when worker flag is enabled');
    assert.ok(!callLog.some((entry) => entry.startsWith('/api/market.csv')),
      'should not use internal market CSV when worker flag is enabled');
  } finally {
    context.restore();
  }
})();

await (async () => {
  const callLog = [];
  const itemsResponse = [createItem(789, 'OtherRoot'), createItem(101112, 'OtherLeaf')];
  const fetchWithCache = async (url) => {
    callLog.push(url);
    if (url.startsWith('/recipe-tree/')) {
      return {
        ok: true,
        json: async () => ({
          id: 789,
          recipe: { output_item_count: 1 },
          components: [
            { type: 'Item', id: 101112, quantity: 1 },
          ],
        }),
      };
    }
    if (url.startsWith('/api/items')) {
      return { ok: true, json: async () => itemsResponse };
    }
    if (url.startsWith('/api/market.csv')) {
      return { ok: false };
    }
    if (url.startsWith('/api/prices')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 789, buy_price: 55, sell_price: 77 },
            { id: 101112, buy_price: 11, sell_price: 22 },
          ],
        }),
      };
    }
    throw new Error(`Unexpected url ${url}`);
  };

  const context = await loadWorker({ fetchWithCache });
  try {
    const result = await runGeneration(context, 789, { output_item_count: 1, ingredients: [] });
    assert.ok(Array.isArray(result.tree), 'worker should respond with tree array for fallback scenario');
    const priceCalls = callLog.filter((entry) => entry.startsWith('/api/prices'));
    assert.ok(priceCalls.length >= 1, 'should fallback to internal prices endpoint when CSV fails');
    const fallbackNode = result.tree.find((node) => node.id === 101112);
    assert.ok(fallbackNode, 'tree should include child node from fallback data');
    assert.strictEqual(fallbackNode.buy_price, 11, 'fallback data should populate buy price');
    assert.strictEqual(fallbackNode.sell_price, 22, 'fallback data should populate sell price');
  } finally {
    context.restore();
  }
})();
