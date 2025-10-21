const assert = require('assert');

process.env.NODE_ENV = 'test';

const apiModulePath = require.resolve('../../backend/api/index.js');
const { registerMockDeps } = require('../helpers/register-mock-deps.js');

const restoreDeps = registerMockDeps();

function loadApi() {
  delete require.cache[apiModulePath];
  return require('../../backend/api/index.js');
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

async function withOverrides(api, { aggregate = {}, legacyHandler = null } = {}, run) {
  if (legacyHandler) {
    api.__setLegacyBundleHandler(legacyHandler);
  }
  api.__setAggregateOverrides({
    getCachedAggregate: aggregate.getCachedAggregate,
    buildItemAggregate: aggregate.buildItemAggregate,
    scheduleAggregateBuild: aggregate.scheduleAggregateBuild,
    isAggregateExpired: aggregate.isAggregateExpired,
  });

  try {
    await run();
  } finally {
    api.__resetAggregateOverrides();
    api.__resetLegacyBundleHandler();
  }
}

async function testHtmlFallbackProducesJsonResponse() {
  const api = loadApi();
  const context = { traceId: 'agg-bundle-html', ts: '2024-04-01T14:00:00.000Z' };
  const request = createMockRequest(context);
  const response = createMockResponse(context);
  const url = new URL('http://localhost/api/aggregate/bundle?ids=101');

  let fallbackCalls = 0;

  await withOverrides(
    api,
    {
      aggregate: {
        getCachedAggregate: async () => null,
        buildItemAggregate: async () => null,
        scheduleAggregateBuild: async () => {},
      },
      legacyHandler: async (_req, res) => {
        fallbackCalls += 1;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>legacy bundle</body></html>');
      },
    },
    async () => {
      await api.handleAggregateBundleJson(request, response, url, 'es');
    },
  );

  assert.strictEqual(fallbackCalls, 1, 'Debe invocar el fallback cuando el agregado falla');
  assert.strictEqual(response.statusCode, 502, 'Debe retornar 502 ante payload HTML del fallback');
  const contentType = response.headers['Content-Type'] || response.headers['content-type'];
  assert.ok(
    typeof contentType === 'string' && contentType.includes('application/json'),
    'La respuesta debe tener content-type JSON',
  );
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.meta.source, 'aggregate');
  assert.strictEqual(payload.meta.stale, true);
  assert.ok(Array.isArray(payload.errors));
  assert.strictEqual(payload.errors[0]?.code, 'aggregate_failed');
  assert.ok(payload.priceMap);
  assert.strictEqual(Object.keys(payload.priceMap).length, 0);
  assert.ok(payload.iconMap);
  assert.strictEqual(Object.keys(payload.iconMap).length, 0);
  assert.ok(payload.rarityMap);
  assert.strictEqual(Object.keys(payload.rarityMap).length, 0);
  assert.strictEqual(response.headers['X-Data-Source'], 'aggregate');
}

async function run() {
  await testHtmlFallbackProducesJsonResponse();
  console.log('tests/api/aggregate-bundle-content-type.test.js passed');
  if (typeof restoreDeps === 'function') {
    restoreDeps();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
