const assert = require('assert');

process.env.NODE_ENV = 'test';

const api = require('../../backend/api/index.js');

function createMockResponse() {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    writeHead(statusCode, incomingHeaders = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, incomingHeaders);
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    end(payload) {
      if (Buffer.isBuffer(payload)) {
        this.body = payload.toString('utf8');
      } else if (typeof payload === 'string') {
        this.body = payload;
      } else if (payload == null) {
        this.body = '';
      } else {
        this.body = String(payload);
      }
      return this;
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
      const rows = ids.map((id) => `${id},${id * 101},${id * 202}`).join('\n');
      return createStubResponse(200, `${header}\n${rows}`);
    }

    throw new Error(`Unhandled URL: ${url}`);
  };
}

async function testAggregateSuccess() {
  const aggregates = new Map([
    [
      1,
      {
        data: {
          item: { id: 1, name: 'Espada Uno', icon: 'icon-1.png', rarity: 'Rare' },
          totals: { unitBuyPrice: 101, unitSellPrice: 202 },
        },
        meta: { snapshotAt: '2024-01-01T00:00:00.000Z', stale: false, warnings: [], errors: [] },
      },
    ],
    [
      2,
      {
        data: {
          item: { id: 2, name: 'Escudo Dos', icon: 'icon-2.png', rarity: 'Fine' },
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

  const request = createRequest('/api/aggregate/bundle?ids[]=1&ids[]=2&lang=es');
  const response = createMockResponse();

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetAggregateOverrides();
  }

  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.deepStrictEqual(payload.priceMap['1'], { id: 1, buy_price: 101, sell_price: 202 });
  assert.deepStrictEqual(payload.priceMap['2'], { id: 2, buy_price: 202, sell_price: 404 });
  assert.strictEqual(payload.iconMap['1'], 'icon-1.png');
  assert.strictEqual(payload.rarityMap['2'], 'Fine');
  assert.strictEqual(payload.meta.lang, 'es');
  assert.strictEqual(payload.meta.source, 'aggregate');
  const cacheControl = response.headers['Cache-Control'] || response.headers['cache-control'];
  assert.strictEqual(
    cacheControl,
    'public, max-age=120, stale-while-revalidate=120',
  );
  const dataSourceHeader = response.headers['X-Data-Source'] || response.headers['x-data-source'];
  assert.strictEqual(dataSourceHeader, 'aggregate');
}

async function testAggregateFallback() {
  api.__setAggregateOverrides({
    async getCachedAggregate() {
      return null;
    },
    async buildItemAggregate() {
      return null;
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

  const request = createRequest('/api/aggregate/bundle?ids[]=1&ids[]=2&lang=es');
  const response = createMockResponse();

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetLegacyOverrides();
    api.__resetAggregateOverrides();
  }

  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.deepStrictEqual(payload.priceMap['1'], { id: 1, buy_price: 101, sell_price: 202 });
  assert.strictEqual(payload.iconMap['2'], 'icon-2.png');
  assert.strictEqual(payload.meta.source, 'fallback');
  const cacheControl = response.headers['Cache-Control'] || response.headers['cache-control'];
  assert.strictEqual(
    cacheControl,
    'public, max-age=75, stale-while-revalidate=75',
  );
  const dataSourceHeader = response.headers['X-Data-Source'] || response.headers['x-data-source'];
  assert.strictEqual(dataSourceHeader, 'fallback');
}

async function testAggregatePaginationAndFields() {
  const aggregates = new Map([
    [
      1,
      {
        data: {
          item: { id: 1, name: 'Uno' },
          totals: { unitBuyPrice: 111, unitSellPrice: 222 },
        },
        meta: { snapshotAt: '2024-01-01T00:00:00.000Z', stale: false },
      },
    ],
    [
      2,
      {
        data: {
          item: { id: 2, name: 'Dos' },
          totals: { unitBuyPrice: 333, unitSellPrice: 444 },
        },
        meta: { snapshotAt: '2024-01-02T00:00:00.000Z', stale: false },
      },
    ],
    [
      3,
      {
        data: {
          item: { id: 3, name: 'Tres' },
          totals: { unitBuyPrice: 555, unitSellPrice: 666 },
        },
        meta: { snapshotAt: '2024-01-03T00:00:00.000Z', stale: false },
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

  const request = createRequest('/api/aggregate/bundle?ids=1,2,3&lang=es&page=2&pageSize=1&fields=priceMap,iconMap');
  const response = createMockResponse();

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetAggregateOverrides();
  }

  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.ok(payload.priceMap);
  assert.deepStrictEqual(Object.keys(payload.priceMap), ['2']);
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'rarityMap'), 'rarityMap should be filtered');
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'itemMap'), 'itemMap should be filtered');
  assert.strictEqual(payload.meta.pagination.page, 2);
  assert.strictEqual(payload.meta.pagination.pageSize, 1);
  assert.strictEqual(payload.meta.pagination.totalIds, 3);
  assert.strictEqual(payload.meta.pagination.hasNext, true);
}

async function run() {
  await testAggregateSuccess();
  await testAggregateFallback();
  await testAggregatePaginationAndFields();
  console.log('tests/api/aggregate-bundle-json.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
