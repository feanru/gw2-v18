const assert = require('assert');

process.env.NODE_ENV = 'test';

const api = require('../../backend/api/index.js');

function createMockResponse(context = {}) {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    __responseContext: { ...context },
    writeHead(statusCode, incomingHeaders) {
      this.statusCode = statusCode;
      Object.assign(this.headers, incomingHeaders);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

function createRequest(pathname) {
  return {
    method: 'GET',
    url: pathname,
    headers: {},
  };
}

function createStubResponse(status, body) {
  return {
    status,
    async text() {
      return body;
    },
  };
}

function createBundleFetchStub(config) {
  const itemsData = {
    es: {
      1: { id: 1, name: 'Espada Uno', icon: 'icon-1.png', rarity: 'Rare' },
      2: { id: 2, name: 'Escudo Dos', icon: 'icon-2.png', rarity: 'Fine' },
    },
    en: {
      1: { id: 1, name: 'Sword One', icon: 'icon-1.png', rarity: 'Rare' },
      2: { id: 2, name: 'Shield Two', icon: 'icon-2.png', rarity: 'Fine' },
    },
  };
  const recipeSearchMap = new Map([
    [1, [501]],
    [2, [502]],
  ]);
  const recipeData = {
    501: { id: 501, output_item_count: 2, ingredients: [{ item_id: 7, count: 3 }] },
    502: { id: 502, output_item_count: 1, ingredients: [{ item_id: 8, count: 5 }] },
  };

  const itemsUrl = new URL(config.itemsEndpoint);
  const recipesUrl = new URL(config.recipesEndpoint);
  const recipesSearchUrl = new URL(config.recipesSearchEndpoint);
  const marketUrl = new URL(config.marketCsvUrl);

  return async function fetchImpl(input) {
    const url = typeof input === 'string' ? input : input?.href || input?.url || String(input);
    const parsed = new URL(url);

    if (parsed.origin === itemsUrl.origin && parsed.pathname === itemsUrl.pathname) {
      const ids = (parsed.searchParams.get('ids') || '')
        .split(',')
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
      const lang = (parsed.searchParams.get('lang') || config.defaultLang || 'es').toLowerCase();
      const langMap = itemsData[lang] || {};
      const payload = ids.map((id) => langMap[id]).filter((entry) => entry);
      return createStubResponse(200, JSON.stringify(payload));
    }

    if (parsed.origin === recipesSearchUrl.origin && parsed.pathname === recipesSearchUrl.pathname) {
      const id = Number.parseInt(parsed.searchParams.get('output') || '0', 10);
      const mapped = recipeSearchMap.get(id) || [];
      return createStubResponse(200, JSON.stringify(mapped));
    }

    if (parsed.origin === recipesUrl.origin && parsed.pathname.startsWith(`${recipesUrl.pathname}/`)) {
      const id = Number.parseInt(parsed.pathname.substring(recipesUrl.pathname.length + 1), 10);
      const data = recipeData[id];
      if (!data) {
        return createStubResponse(404, '');
      }
      return createStubResponse(200, JSON.stringify(data));
    }

    if (parsed.origin === marketUrl.origin && parsed.pathname === marketUrl.pathname) {
      const ids = (parsed.searchParams.get('ids') || '')
        .split(',')
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
      const header = 'id,buy_price,sell_price';
      const rows = ids
        .map((id) => `${id},${id * 101},${id * 202}`)
        .join('\n');
      return createStubResponse(200, `${header}\n${rows}`);
    }

    throw new Error(`Unhandled URL: ${url}`);
  };
}

async function testMissingIdsReturns400() {
  const request = createRequest('/api/items/bundle');
  const response = createMockResponse();

  await api.handleApiRequest(request, response);

  assert.strictEqual(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.data, null);
  assert.ok(Array.isArray(payload.errors));
  assert.strictEqual(payload.errors[0].code, 'ids_required');
  assert.strictEqual(payload.meta.source, 'aggregate');
  const contentTypeMissingIds =
    response.headers['Content-Type'] ?? response.headers['content-type'];
  assert.strictEqual(
    contentTypeMissingIds,
    'application/json; charset=utf-8',
    'responses without ids should return JSON content-type',
  );
}

async function testSuccessfulBundleResponse() {
  const aggregates = new Map([
    [
      1,
      {
        data: {
          item: { id: 1, name: 'Espada Uno', rarity: 'Rare' },
          totals: { unitBuyPrice: 101, unitSellPrice: 202 },
        },
        meta: { snapshotAt: '2024-01-01T00:00:00.000Z', stale: false, warnings: [], errors: [] },
      },
    ],
    [
      2,
      {
        data: {
          item: { id: 2, name: 'Escudo Dos', rarity: 'Fine' },
          totals: { unitBuyPrice: 202, unitSellPrice: 404 },
        },
        meta: { snapshotAt: '2024-01-02T00:00:00.000Z', stale: false, warnings: [], errors: [] },
      },
    ],
  ]);

  api.__setAggregateOverrides({
    async getCachedAggregate(itemId) {
      return aggregates.get(itemId) || null;
    },
    async buildItemAggregate(itemId) {
      return aggregates.get(itemId) || null;
    },
  });

  const config = {
    defaultLang: 'es',
    cacheTtlFast: 75,
    itemsEndpoint: 'https://api.example.test/v2/items',
    recipesEndpoint: 'https://api.example.test/v2/recipes',
    recipesSearchEndpoint: 'https://api.example.test/v2/recipes/search',
    marketCsvUrl: 'https://market.example.test/v1/items/csv',
  };
  const fetchImpl = createBundleFetchStub(config);

  api.__setLegacyOverrides({ fetchImpl, config });
  const request = createRequest('/api/items/bundle?ids=1,2&lang=es');
  const response = createMockResponse();

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetLegacyOverrides();
    api.__resetAggregateOverrides();
  }

  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.ok(payload.data);
  const { items, market } = payload.data;
  assert.ok(items);
  assert.ok(market);
  assert.deepStrictEqual(items[1], { id: 1, name: 'Espada Uno', rarity: 'Rare' });
  assert.deepStrictEqual(items[2], { id: 2, name: 'Escudo Dos', rarity: 'Fine' });
  assert.deepStrictEqual(market[1], { id: 1, buy_price: 101, sell_price: 202 });
  assert.deepStrictEqual(market[2], { id: 2, buy_price: 202, sell_price: 404 });
  assert.ok(!payload.errors || payload.errors.length === 0);
  assert.strictEqual(payload.meta.lang, 'es');
  assert.strictEqual(payload.meta.source, 'aggregate');
  assert.strictEqual(payload.meta.stale, false);
  const cacheControlHeader =
    response.headers['cache-control'] ?? response.headers['Cache-Control'];
  assert.strictEqual(cacheControlHeader, 'public, max-age=120, stale-while-revalidate=120');
  const contentType = response.headers['Content-Type'] ?? response.headers['content-type'];
  assert.strictEqual(
    contentType,
    'application/json; charset=utf-8',
    'bundle responses should expose JSON content-type',
  );
}

async function testBundleUnexpectedError() {
  api.__setAggregateOverrides({
    async getCachedAggregate() {
      return null;
    },
    async buildItemAggregate() {
      throw new Error('aggregate unavailable');
    },
  });

  const config = {
    defaultLang: 'es',
    cacheTtlFast: 60,
    itemsEndpoint: 'https://api.example.test/v2/items',
    recipesEndpoint: 'https://api.example.test/v2/recipes',
    recipesSearchEndpoint: 'https://api.example.test/v2/recipes/search',
    marketCsvUrl: 'https://market.example.test/v1/items/csv',
  };
  const failingFetch = async () => createStubResponse(200, 'not-json');
  const throwingLogger = {
    warn() {
      throw new Error('logger failure');
    },
    error() {},
  };

  api.__setLegacyOverrides({ fetchImpl: failingFetch, config, logger: throwingLogger });
  const request = createRequest('/api/items/bundle?ids=1');
  const response = createMockResponse();

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetLegacyOverrides();
    api.__resetAggregateOverrides();
  }

  assert.strictEqual(response.statusCode, 500);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.data, null);
  assert.ok(Array.isArray(payload.errors));
  assert.strictEqual(payload.errors[0].code, 'data_bundle_unexpected');
  assert.strictEqual(payload.meta.source, 'fallback');
  assert.strictEqual(payload.meta.stale, true);
}

async function run() {
  await testMissingIdsReturns400();
  await testSuccessfulBundleResponse();
  await testBundleUnexpectedError();
  console.log('tests/api/items-bundle.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
