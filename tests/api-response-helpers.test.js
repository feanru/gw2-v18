const assert = require('assert');
const { ok, fail } = require('../backend/api/index.js');

function createMockResponse(context) {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    __responseContext: context,
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
  const successContext = {
    traceId: 'trace-success',
    ts: '2024-01-01T00:00:00.000Z',
  };
  const successResponse = createMockResponse(successContext);
  ok(successResponse, { foo: 'bar' }, {
    lang: 'en',
    stale: false,
    lastUpdated: '2024-01-02T03:04:05.000Z',
  });
  assert.strictEqual(successResponse.statusCode, 200);
  assert.strictEqual(successResponse.headers['Content-Type'], 'application/json; charset=utf-8');
  const successPayload = JSON.parse(successResponse.body);
  assert.deepStrictEqual(successPayload.data, { foo: 'bar' });
  assert.strictEqual(successPayload.meta.lang, 'en');
  assert.strictEqual(successPayload.meta.stale, false);
  assert.strictEqual(successPayload.meta.lastUpdated, '2024-01-02T03:04:05.000Z');
  assert.strictEqual(successPayload.meta.traceId, successContext.traceId);
  assert.strictEqual(successPayload.meta.ts, successContext.ts);
  assert.ok(!('errors' in successPayload));

  const nullLastUpdatedContext = {
    traceId: 'trace-null-last-updated',
    ts: '2024-03-04T05:06:07.000Z',
  };
  const nullLastUpdatedResponse = createMockResponse(nullLastUpdatedContext);
  ok(
    nullLastUpdatedResponse,
    { fizz: 'buzz' },
    {
      lang: 'fr',
      stale: false,
      lastUpdated: null,
    },
  );
  const nullLastUpdatedPayload = JSON.parse(nullLastUpdatedResponse.body);
  assert.strictEqual(nullLastUpdatedPayload.meta.lastUpdated, null);
  assert.strictEqual(nullLastUpdatedPayload.meta.traceId, nullLastUpdatedContext.traceId);
  assert.strictEqual(nullLastUpdatedPayload.meta.ts, nullLastUpdatedContext.ts);

  const failureContext = {
    traceId: 'trace-fail',
    ts: '2024-02-03T10:20:30.000Z',
  };
  const failureResponse = createMockResponse(failureContext);
  fail(
    failureResponse,
    404,
    'errorNotFound',
    'Item not found',
    {
      lang: 'es',
      stale: true,
    },
    'errorNotFound',
  );
  assert.strictEqual(failureResponse.statusCode, 404);
  assert.strictEqual(failureResponse.headers['Content-Type'], 'application/json; charset=utf-8');
  const failurePayload = JSON.parse(failureResponse.body);
  assert.strictEqual(failurePayload.data, null);
  assert.deepStrictEqual(failurePayload.errors, [
    {
      code: 'errorNotFound',
      msg: 'Item not found',
    },
  ]);
  assert.strictEqual(failurePayload.meta.lang, 'es');
  assert.strictEqual(failurePayload.meta.stale, true);
  assert.strictEqual(failurePayload.meta.traceId, failureContext.traceId);
  assert.strictEqual(failurePayload.meta.ts, failureContext.ts);
  assert.strictEqual(typeof failurePayload.meta.lastUpdated, 'string');

  console.log('api-response-helpers.test.js passed');
})();
