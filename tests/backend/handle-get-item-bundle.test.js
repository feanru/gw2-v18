const assert = require('assert');

process.env.NODE_ENV = 'test';

const legacyHandlersModule = require('../../backend/api/legacy/handlers.js');
const originalCreateLegacyHandlers = legacyHandlersModule.createLegacyHandlers;
const apiModulePath = require.resolve('../../backend/api/index.js');

function loadApi({ legacyHandler } = {}) {
  delete require.cache[apiModulePath];
  if (legacyHandler) {
    legacyHandlersModule.createLegacyHandlers = () => ({ handleDataBundle: legacyHandler });
  } else {
    legacyHandlersModule.createLegacyHandlers = originalCreateLegacyHandlers;
  }
  const api = require('../../backend/api/index.js');
  legacyHandlersModule.createLegacyHandlers = originalCreateLegacyHandlers;
  return api;
}

function createMockResponse(context = {}) {
  return {
    statusCode: null,
    body: null,
    headers: {},
    __responseContext: { ...context },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers);
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createMockRequest(context = {}) {
  return {
    method: 'GET',
    headers: {},
    __responseContext: { ...context },
  };
}

function createAggregatePayload(itemId, { stale = false } = {}) {
  return {
    data: {
      item: { id: itemId, name: `Item ${itemId}` },
      totals: { unitBuyPrice: itemId * 2, unitSellPrice: itemId * 3 },
    },
    meta: {
      itemId,
      lang: 'es',
      snapshotAt: '2024-01-01T00:00:00.000Z',
      generatedAt: '2024-01-01T00:00:00.000Z',
      stale,
      warnings: [],
      errors: [],
    },
  };
}

async function withAggregateOverrides(api, overrides, fn) {
  api.__setAggregateOverrides(overrides);
  try {
    await fn();
  } finally {
    api.__resetAggregateOverrides();
  }
}

async function testReturnsAggregateMetaWhenResolved() {
  const api = loadApi();
  const context = { traceId: 'bundle-complete', ts: '2024-04-01T10:00:00.000Z' };
  const request = createMockRequest(context);
  const response = createMockResponse(context);
  const url = new URL('http://localhost/api/items/bundle?ids=101,202');

  const cached = new Map([
    [101, createAggregatePayload(101)],
    [202, createAggregatePayload(202)],
  ]);

  await withAggregateOverrides(
    api,
    {
      getCachedAggregate: async (itemId) => cached.get(itemId) || null,
      buildItemAggregate: async () => {
        throw new Error('build should not run');
      },
    },
    async () => {
      await api.handleGetItemBundle(request, response, url, 'es');
    },
  );

  assert.strictEqual(response.statusCode, 200, 'Debe responder 200 con agregado completo');
  assert.strictEqual(response.headers['X-Data-Source'], undefined);
  const payload = JSON.parse(response.body);
  assert.deepStrictEqual(Object.keys(payload.data.items).sort(), ['101', '202']);
  assert.strictEqual(payload.meta.source, 'aggregate');
  assert.strictEqual(payload.meta.stale, false);
  assert.strictEqual(payload.data.items['101']?.id, 101);
  assert.strictEqual(payload.data.market['202']?.sell_price, 202 * 3);
}

async function testUsesFallbackWhenAggregateIncomplete() {
  let fallbackCalls = 0;
  const api = loadApi({
    legacyHandler: async (_req, res) => {
      fallbackCalls += 1;
      const payload = {
        meta: { source: 'legacy', stale: false },
        data: {
          items: {
            555: { id: 555, name: 'Cached 555' },
            777: { id: 777, name: 'Legacy 777' },
          },
          market: {
            555: { buy_price: 10, sell_price: 20 },
            777: { buy_price: 30, sell_price: 60 },
          },
          meta: { stale: false },
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    },
  });
  const context = { traceId: 'bundle-partial', ts: '2024-04-01T11:00:00.000Z' };
  const request = createMockRequest(context);
  const response = createMockResponse(context);
  const url = new URL('http://localhost/api/items/bundle?ids=555,777');

  const cached = new Map([[555, createAggregatePayload(555)]]);

  await withAggregateOverrides(
    api,
    {
      getCachedAggregate: async (itemId) => cached.get(itemId) || null,
      buildItemAggregate: async () => null,
    },
    async () => {
      await api.handleGetItemBundle(request, response, url, 'es');
    },
  );

  assert.strictEqual(fallbackCalls, 1, 'Debe invocar el fallback una vez');
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.headers['X-Data-Source'], undefined);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.meta.source, 'fallback');
  assert.strictEqual(payload.data.items['777']?.name, 'Legacy 777');
  assert.strictEqual(payload.data.market['777']?.sell_price, 60);
}

async function testPropagatesFallbackErrorsWhenAggregateFails() {
  const errorHandler = async (_req, res) => {
    const payload = {
      meta: { source: 'legacy', stale: true, warnings: ['upstream-error'] },
      data: {
        items: {},
        market: {},
        meta: { stale: true },
        errors: [{ code: 'legacy_failed', msg: 'Legacy bundle error' }],
      },
      errors: [{ code: 'legacy_failed', msg: 'Legacy bundle error' }],
    };
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  let fallbackCalls = 0;
  const wrappedHandler = async (req, res, info) => {
    fallbackCalls += 1;
    await errorHandler(req, res, info);
  };

  const api = loadApi({ legacyHandler: wrappedHandler });
  const context = { traceId: 'bundle-error', ts: '2024-04-01T12:00:00.000Z' };
  const request = createMockRequest(context);
  const response = createMockResponse(context);
  const url = new URL('http://localhost/api/items/bundle?ids=888');

  await withAggregateOverrides(
    api,
    {
      getCachedAggregate: async () => {
        throw new Error('cache read failed');
      },
      buildItemAggregate: async () => {
        throw new Error('aggregate build failed');
      },
    },
    async () => {
      await api.handleGetItemBundle(request, response, url, 'es');
    },
  );

  assert.strictEqual(fallbackCalls, 1, 'Debe intentar el fallback incluso ante fallos');
  assert.strictEqual(response.statusCode, 502);
  assert.strictEqual(response.headers['X-Data-Source'], undefined);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.meta.source, 'fallback');
  assert.ok(Array.isArray(payload.errors));
  assert.strictEqual(payload.errors[0]?.code, 'legacy_failed');
}

async function run() {
  await testReturnsAggregateMetaWhenResolved();
  await testUsesFallbackWhenAggregateIncomplete();
  await testPropagatesFallbackErrorsWhenAggregateFails();
  console.log('tests/backend/handle-get-item-bundle.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

