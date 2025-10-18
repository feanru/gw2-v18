const assert = require('assert');
const { fail } = require('../../backend/api/index.js');

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

(function run() {
  const context = {
    traceId: 'trace-error-format',
    ts: '2024-01-01T00:00:00.000Z',
  };
  const response = createMockResponse(context);
  fail(
    response,
    500,
    'errorUnexpected',
    'Unexpected error',
    {
      errors: ['aggregateFallback'],
      lang: 'en',
      stale: true,
    },
    { code: 'errorSecondary', msg: 'Secondary issue' },
    'aggregateFallback',
  );

  assert.strictEqual(response.statusCode, 500);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.data, null);
  assert.deepStrictEqual(payload.errors, [
    { code: 'errorUnexpected', msg: 'Unexpected error' },
    { code: 'aggregateFallback', msg: 'aggregateFallback' },
    { code: 'errorSecondary', msg: 'Secondary issue' },
  ]);
  assert.strictEqual(payload.meta.traceId, context.traceId);
  assert.strictEqual(payload.meta.ts, context.ts);
  assert.strictEqual(payload.meta.lang, 'en');
  assert.strictEqual(payload.meta.stale, true);
  console.log('tests/api/error-format.test.js passed');
})();
