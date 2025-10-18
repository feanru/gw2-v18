const assert = require('assert');
const api = require('../../backend/api/index.js');

function createMockRequest(url, headers = {}) {
  const normalizedHeaders = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (!key) {
      return;
    }
    normalizedHeaders[key.toLowerCase()] = value;
  });
  return {
    method: 'GET',
    url,
    headers: normalizedHeaders,
  };
}

function createMockResponse(context = {}) {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    __responseContext: { ...context },
    writeHead(statusCode, incomingHeaders = {}) {
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

async function testSuccessResponse() {
  const mongoCalls = [];
  const mongoStub = {
    db() {
      return {
        collection(name) {
          assert.strictEqual(name, 'prices');
          return {
            find(filter, options) {
              mongoCalls.push({ filter, options });
              return {
                async toArray() {
                  return [
                    {
                      _id: 'ignore-me',
                      id: 456,
                      buy_price: 321,
                      sell_price: 654,
                      buy_quantity: 10,
                      sell_quantity: 20,
                      last_updated: '2024-03-01T00:00:00Z',
                      lang: 'en',
                    },
                    {
                      id: '789',
                      buy_price: 987,
                      sell_price: 123,
                      last_updated: new Date('2024-03-02T00:00:00Z'),
                      source: 'external',
                    },
                  ];
                },
              };
            },
          };
        },
      };
    },
  };

  api.__setMongoClient(mongoStub);
  const request = createMockRequest('/api/prices?ids=789,456');
  const response = createMockResponse({ traceId: 'prices-success' });

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetMongoClient();
  }

  assert.strictEqual(mongoCalls.length, 1);
  assert.deepStrictEqual(mongoCalls[0].filter, { id: { $in: [456, 789] } });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.strictEqual(
    response.headers['Cache-Control'],
    'public, max-age=120, stale-while-revalidate=120',
  );
  assert.ok(response.body, 'response should include body payload');
  const payload = JSON.parse(response.body);
  assert.ok(Array.isArray(payload.data), 'payload should include data array');
  assert.deepStrictEqual(payload.data, [
    {
      id: 456,
      buy_price: 321,
      sell_price: 654,
      buy_quantity: 10,
      sell_quantity: 20,
      last_updated: '2024-03-01T00:00:00Z',
    },
    {
      id: 789,
      buy_price: 987,
      sell_price: 123,
      last_updated: '2024-03-02T00:00:00.000Z',
    },
  ]);
  assert.strictEqual(payload.meta.source, 'prices');
  assert.strictEqual(payload.meta.stale, false);
  assert.strictEqual(payload.meta.lang, 'es');
  assert.deepStrictEqual(payload.meta.ids, [456, 789]);
  assert.strictEqual(payload.meta.count, 2);
  assert.strictEqual(payload.meta.traceId, 'prices-success');
  assert.ok(
    typeof payload.meta.lastUpdated === 'string' && payload.meta.lastUpdated.length > 0,
    'meta should include lastUpdated timestamp',
  );
  assert.ok(!payload.errors, 'payload should not include errors on success');
}

async function testMissingIds() {
  const request = createMockRequest('/api/prices');
  const response = createMockResponse({ traceId: 'prices-missing-ids' });

  await api.handleApiRequest(request, response);

  assert.strictEqual(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.data, null);
  assert.strictEqual(payload.meta.source, 'prices');
  assert.strictEqual(payload.meta.stale, false);
  assert.ok(Array.isArray(payload.errors) && payload.errors.length > 0);
  assert.strictEqual(payload.errors[0].code, 'ids_required');
}

(async () => {
  await testSuccessResponse();
  await testMissingIds();
})();
