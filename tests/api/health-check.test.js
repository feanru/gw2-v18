const assert = require('assert');
const api = require('../../backend/api/index.js');

process.env.NODE_ENV = 'test';

function createMockRequest(url) {
  return {
    method: 'GET',
    url,
    headers: {},
  };
}

function createMockResponse() {
  const headers = {};
  const listeners = {};
  return {
    statusCode: null,
    body: null,
    headers,
    on(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    writeHead(statusCode, incomingHeaders = {}) {
      this.statusCode = statusCode;
      Object.entries(incomingHeaders).forEach(([key, value]) => {
        headers[String(key).toLowerCase()] = value;
      });
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()] ?? undefined;
    },
    end(payload) {
      this.body = payload;
      if (listeners.finish) {
        listeners.finish.forEach((fn) => {
          try {
            fn();
          } catch (err) {
            // Ignore test callbacks throwing to prevent cascading failures.
          }
        });
      }
      if (typeof this.resolve === 'function') {
        this.resolve();
      }
    },
  };
}

function dispatch(request, response) {
  return new Promise((resolve, reject) => {
    response.resolve = resolve;
    try {
      api(request, response);
    } catch (err) {
      reject(err);
    }
  });
}

(async () => {
  const healthyMongo = {
    db() {
      return {
        async command() {
          return { ok: 1 };
        },
      };
    },
  };
  const healthyRedis = {
    isOpen: true,
    async ping() {
      return 'PONG';
    },
  };

  api.__setMongoClient(healthyMongo);
  api.__setRedisClient(healthyRedis);

  const healthyResponse = createMockResponse();
  const healthyRequest = createMockRequest('/api/healthz');
  await dispatch(healthyRequest, healthyResponse);

  assert.strictEqual(healthyResponse.statusCode, 200, 'health endpoint should succeed when dependencies are healthy');
  const healthyPayload = JSON.parse(healthyResponse.body);
  assert.strictEqual(healthyPayload.data.status, 'ok');
  assert.strictEqual(healthyPayload.data.components.mongo.ok, true);
  assert.strictEqual(healthyPayload.data.components.redis.ok, true);
  assert.strictEqual(healthyPayload.meta.source, 'health');
  assert.strictEqual(healthyPayload.meta.stale, false);

  api.__resetMongoClient();
  api.__resetRedisClient();

  const failingMongo = {
    db() {
      return {
        async command() {
          throw new Error('mongo offline');
        },
      };
    },
  };
  const failingRedis = {
    isOpen: false,
    async ping() {
      throw new Error('redis offline');
    },
  };

  api.__setMongoClient(failingMongo);
  api.__setRedisClient(failingRedis);

  const degradedResponse = createMockResponse();
  const degradedRequest = createMockRequest('/api/healthz');
  await dispatch(degradedRequest, degradedResponse);

  assert.strictEqual(degradedResponse.statusCode, 503, 'health endpoint should report degraded when dependencies fail');
  const degradedPayload = JSON.parse(degradedResponse.body);
  assert.strictEqual(degradedPayload.data.status, 'degraded');
  assert.strictEqual(degradedPayload.data.components.mongo.ok, false);
  assert.strictEqual(degradedPayload.data.components.redis.ok, false);
  assert.strictEqual(degradedPayload.meta.stale, true);

  api.__resetMongoClient();
  api.__resetRedisClient();

  console.log('tests/api/health-check.test.js passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
