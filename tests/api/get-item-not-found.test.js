const assert = require('assert');
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

async function run() {
  const context = {
    traceId: 'trace-item-not-found',
    ts: '2024-01-01T00:00:00.000Z',
  };
  const response = createMockResponse(context);

  const originalReadItemSnapshot = api.readItemSnapshot;
  api.readItemSnapshot = async () => null;

  try {
    await api.handleGetItem(response, 123456, 'es');
  } finally {
    api.readItemSnapshot = originalReadItemSnapshot;
  }

  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.data, null);
  assert.ok(Array.isArray(payload.errors));
  assert.strictEqual(payload.errors[0].code, 'not_found');
  assert.strictEqual(payload.errors[0].msg, 'Item not found');
  assert.strictEqual(payload.meta.lang, 'es');
  assert.strictEqual(payload.meta.lastUpdated, null);
  assert.strictEqual(payload.meta.stale, false);
  assert.strictEqual(
    response.headers['Cache-Control'],
    'public, max-age=120, stale-while-revalidate=120',
  );

  console.log('tests/api/get-item-not-found.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
