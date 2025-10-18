const assert = require('assert');
const recipeTree = require('../backend/api/recipeTree.js');

function createMockRequest(id) {
  return {
    method: 'GET',
    url: `/recipe-tree/${id}`,
    params: { id: String(id) },
  };
}

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

class MockMongo {
  constructor(doc) {
    this.doc = doc;
    this.findCalls = 0;
  }
  get topology() {
    return { isConnected: () => true };
  }
  async connect() {}
  db() {
    return {
      collection: () => ({
        findOne: async () => {
          this.findCalls += 1;
          return this.doc;
        },
      }),
    };
  }
}

class MockRedis {
  constructor() {
    this.store = new Map();
    this.hGetCalls = 0;
    this.hSetCalls = 0;
  }
  get isOpen() {
    return true;
  }
  async connect() {}
  async hGet(hash, key) {
    this.hGetCalls += 1;
    return this.store.get(key) || null;
  }
  async hSet(hash, key, value) {
    this.hSetCalls += 1;
    this.store.set(key, value);
  }
}

const { getRecipeTree } = recipeTree;

(async () => {
  const doc = { id: 42, nodes: [], lastUpdated: '2024-01-02T03:04:05.000Z' };
  const mongo = new MockMongo(doc);
  const redis = new MockRedis();

  const first = await getRecipeTree(42, { mongoClient: mongo, redisClient: redis });
  assert.deepStrictEqual(first, doc);
  assert.strictEqual(mongo.findCalls, 1);
  assert.strictEqual(redis.hGetCalls, 1);
  assert.strictEqual(redis.hSetCalls, 1);

  const second = await getRecipeTree(42, { mongoClient: mongo, redisClient: redis });
  assert.deepStrictEqual(second, doc);
  assert.strictEqual(mongo.findCalls, 1);
  assert.strictEqual(redis.hGetCalls, 2);
  assert.strictEqual(redis.hSetCalls, 1);

  const context = {
    traceId: 'trace-recipe-tree-success',
    ts: '2024-03-04T05:06:07.000Z',
  };
  const res = createMockResponse(context);
  await recipeTree(createMockRequest(42), res, { mongoClient: mongo, redisClient: redis });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['Content-Type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(res.body);
  assert.deepStrictEqual(payload.data, doc);
  assert.strictEqual(payload.meta.traceId, context.traceId);
  assert.strictEqual(payload.meta.ts, context.ts);
  assert.strictEqual(payload.meta.lang, 'es');
  assert.strictEqual(payload.meta.stale, false);
  assert.strictEqual(payload.meta.lastUpdated, doc.lastUpdated);
  assert.ok(!('errors' in payload));

  const missingContext = {
    traceId: 'trace-recipe-tree-missing',
    ts: '2024-05-06T07:08:09.000Z',
  };
  const missingRes = createMockResponse(missingContext);
  const missingMongo = new MockMongo(null);
  const missingRedis = new MockRedis();
  await recipeTree(createMockRequest(404), missingRes, {
    mongoClient: missingMongo,
    redisClient: missingRedis,
  });
  assert.strictEqual(missingRes.statusCode, 404);
  assert.strictEqual(missingRes.headers['Content-Type'], 'application/json; charset=utf-8');
  const missingPayload = JSON.parse(missingRes.body);
  assert.strictEqual(missingPayload.data, null);
  assert.deepStrictEqual(missingPayload.errors, [
    {
      code: 'errorNotFound',
      msg: 'Recipe tree not found',
    },
  ]);
  assert.strictEqual(missingPayload.meta.traceId, missingContext.traceId);
  assert.strictEqual(missingPayload.meta.ts, missingContext.ts);
  assert.strictEqual(missingPayload.meta.lang, 'es');
  assert.strictEqual(missingPayload.meta.stale, false);
  assert.strictEqual(missingPayload.meta.lastUpdated, missingContext.ts);

  console.log('recipeTree.test.js passed');
})();
