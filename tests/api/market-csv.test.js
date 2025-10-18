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

async function testIdsParam() {
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
                      id: 123,
                      buy_price: 100,
                      sell_price: 200,
                      buy_quantity: 10,
                      sell_quantity: 20,
                      last_updated: '2024-01-01T00:00:00Z',
                      lastUpdated: new Date('2024-01-01T00:00:00Z'),
                    },
                    {
                      id: 456,
                      buy_price: 300,
                      sell_price: 400,
                      buy_quantity: 30,
                      sell_quantity: 40,
                      last_updated: '2024-01-02T00:00:00Z',
                      lastUpdated: new Date('2024-01-02T00:00:00Z'),
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
  const request = createMockRequest('/api/market.csv?ids=123,456&fields=id,buy_price,sell_price,last_updated');
  const response = createMockResponse({ traceId: 'market-csv-ids' });

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetMongoClient();
  }

  assert.strictEqual(mongoCalls.length, 1);
  assert.deepStrictEqual(mongoCalls[0].filter, { id: { $in: [123, 456] } });
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.strictEqual(
    response.headers['Cache-Control'],
    'public, max-age=120, stale-while-revalidate=120',
  );
  assert.ok(response.headers.ETag);
  assert.ok(response.headers['Last-Modified']);
  assert.ok(response.headers['Content-Length']);
  assert.ok(typeof response.body === 'string');
  const lines = response.body.trim().split('\n');
  assert.deepStrictEqual(lines[0], 'id,buy_price,sell_price,last_updated');
  assert.deepStrictEqual(lines[1], '123,100,200,2024-01-01T00:00:00Z');
  assert.deepStrictEqual(lines[2], '456,300,400,2024-01-02T00:00:00Z');
}

async function testIdsArrayParam() {
  const mongoStub = {
    db() {
      return {
        collection(name) {
          assert.strictEqual(name, 'prices');
          return {
            find() {
              return {
                async toArray() {
                  return [
                    { id: 456, buy_price: 10, sell_price: 20, last_updated: '2024-01-05T00:00:00Z' },
                    { id: 789, buy_price: 30, sell_price: 40, last_updated: '2024-01-06T00:00:00Z' },
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
  const request = createMockRequest('/api/market.csv?ids[]=789&ids[]=456&fields=id,buy_price');
  const response = createMockResponse({ traceId: 'market-csv-array' });

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.__resetMongoClient();
  }

  assert.strictEqual(response.statusCode, 200);
  const lines = response.body.trim().split('\n');
  assert.deepStrictEqual(lines[0], 'id,buy_price');
  // ids are normalized and sorted ascending
  assert.deepStrictEqual(lines[1], '456,10');
  assert.deepStrictEqual(lines[2], '789,30');
}

async function testConditionalRequest() {
  const mongoStub = {
    db() {
      return {
        collection(name) {
          assert.strictEqual(name, 'prices');
          return {
            find() {
              return {
                async toArray() {
                  return [
                    { id: 321, buy_price: 5, sell_price: 6, last_updated: '2024-02-01T12:00:00Z' },
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
  const initialRequest = createMockRequest('/api/market.csv?ids=321&fields=id,buy_price');
  const initialResponse = createMockResponse({ traceId: 'market-csv-etag' });

  try {
    await api.handleApiRequest(initialRequest, initialResponse);
  } finally {
    api.__resetMongoClient();
  }

  assert.strictEqual(initialResponse.statusCode, 200);
  const etag = initialResponse.headers.ETag;
  const lastModified = initialResponse.headers['Last-Modified'];
  assert.ok(etag);
  assert.ok(lastModified);

  const conditionalRequest = createMockRequest(
    '/api/market.csv?ids=321&fields=id,buy_price',
    { 'if-none-match': etag },
  );
  const conditionalResponse = createMockResponse({ traceId: 'market-csv-conditional' });

  api.__setMongoClient(mongoStub);
  try {
    await api.handleApiRequest(conditionalRequest, conditionalResponse);
  } finally {
    api.__resetMongoClient();
  }

  assert.strictEqual(conditionalResponse.statusCode, 304);
  assert.strictEqual(conditionalResponse.body, undefined);
  assert.strictEqual(conditionalResponse.headers.ETag, etag);
  assert.strictEqual(conditionalResponse.headers['Last-Modified'], lastModified);
}

(async () => {
  await testIdsParam();
  await testIdsArrayParam();
  await testConditionalRequest();
  console.log('tests/api/market-csv.test.js passed');
})();
