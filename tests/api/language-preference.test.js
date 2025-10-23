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
  const context = { traceId: 'trace-lang', ts: '2024-01-01T00:00:00.000Z' };
  const response = createMockResponse(context);

  const mongoStub = {
    db() {
      return {
        collection(name) {
          if (name === 'recipes') {
            return {
              find() {
                return {
                  limit() { return this; },
                  async toArray() { return []; },
                };
              },
            };
          }
          if (name === 'prices') {
            return { async findOne() { return null; } };
          }
          if (name === 'recipeTrees') {
            return { async findOne() { return null; } };
          }
          return { async findOne() { return null; } };
        },
      };
    },
  };

  const originalReadItemSnapshot = api.readItemSnapshot;
  const callLog = [];
  api.readItemSnapshot = async (itemId, lang) => {
    callLog.push(lang);
    return {
      item: { id: itemId, name: `Item-${lang}` },
      meta: {
        lang: 'en',
        source: 'cache',
        lastUpdated: '2024-01-01T00:00:00.000Z',
        stale: false,
      },
    };
  };

  api.__setMongoClient(mongoStub);
  const redisStub = {
    isOpen: true,
    async hGet() { return null; },
    async hSet() { return 'OK'; },
  };
  api.__setRedisClient(redisStub);

  const request = {
    method: 'GET',
    url: '/api/items/123',
    headers: { 'accept-language': 'en-US,en;q=0.9' },
  };

  try {
    await api.handleApiRequest(request, response);
  } finally {
    api.readItemSnapshot = originalReadItemSnapshot;
    api.__resetMongoClient();
    api.__resetRedisClient();
  }

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(callLog[0], 'en-us', 'Debe solicitar primero el idioma preferido del header');

  const payload = JSON.parse(response.body);
  assert.strictEqual(payload.meta.lang, 'en');
  assert.strictEqual(payload.meta.requestedLang, 'en-us');
  assert.ok(Array.isArray(payload.meta.warnings));
  assert.ok(payload.meta.warnings.includes('lang-fallback:en'));
  assert.strictEqual(response.headers['Content-Language'], 'en');

  console.log('tests/api/language-preference.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
