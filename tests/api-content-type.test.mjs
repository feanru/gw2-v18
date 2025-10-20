import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import Module from 'node:module';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';

const originalModuleLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
  if (request === 'mongodb') {
    class FakeMongoClient {
      constructor() {
        this.isConnected = false;
      }

      async connect() {
        this.isConnected = true;
        return this;
      }

      db() {
        return {};
      }

      close() {
        this.isConnected = false;
      }
    }
    return { MongoClient: FakeMongoClient };
  }
  if (request === 'redis') {
    return {
      createClient() {
        return {
          isOpen: true,
          on() {},
          async connect() {},
          async quit() {},
          async disconnect() {},
        };
      },
    };
  }
  return originalModuleLoad(request, parent, isMain);
};

const require = createRequire(import.meta.url);
const api = require('../backend/api/index.js');
Module._load = originalModuleLoad;

const {
  __setAggregateOverrides,
  __resetAggregateOverrides,
  __setLegacyBundleHandler,
  __resetLegacyBundleHandler,
} = api;

function createAggregateStub(itemId, lang) {
  return {
    data: {
      item: { id: itemId, name: `Item ${itemId}` },
      totals: {
        unitBuyPrice: 111,
        unitSellPrice: 222,
      },
    },
    meta: {
      itemId,
      lang,
      source: 'aggregate',
      stale: false,
      snapshotAt: '2024-01-01T00:00:00.000Z',
    },
    cache: {
      stale: false,
      storedAt: Date.now(),
      softTtlMs: 60000,
    },
  };
}

async function startServer() {
  const server = http.createServer(api);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('Unable to determine server address');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return { server, origin };
}

async function stopServer(server) {
  server.close();
  await once(server, 'close');
}

async function testAggregateEndpointReturnsJson() {
  __setAggregateOverrides({
    getCachedAggregate: async (itemId, lang) => createAggregateStub(itemId, lang),
    buildItemAggregate: async (itemId, lang) => createAggregateStub(itemId, lang),
    scheduleAggregateBuild: async () => {},
    isAggregateExpired: () => false,
  });

  const { server, origin } = await startServer();
  try {
    const response = await fetch(`${origin}/api/items/123/aggregate`);
    assert.equal(response.status, 200, 'aggregate endpoint should respond 200');
    const contentType = response.headers.get('content-type');
    assert.equal(
      contentType,
      'application/json; charset=utf-8',
      'aggregate endpoint should return JSON content-type',
    );
    const body = await response.json();
    assert.equal(body?.meta?.source, 'aggregate');
    assert.equal(body?.meta?.lang, 'es');
    assert.deepEqual(body?.data?.item?.id, 123);
  } finally {
    await stopServer(server);
    __resetAggregateOverrides();
  }
}

async function testLegacyFallbackInvalidJson() {
  __setAggregateOverrides({
    getCachedAggregate: async () => null,
    buildItemAggregate: async () => ({ data: null, meta: null }),
    scheduleAggregateBuild: async () => {},
    isAggregateExpired: () => false,
  });

  __setLegacyBundleHandler(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>legacy failure</html>');
  });

  const { server, origin } = await startServer();
  try {
    const response = await fetch(`${origin}/api/items/bundle?ids=42`);
    assert.equal(response.status, 502, 'fallback invalid JSON should surface as 502');
    const contentType = response.headers.get('content-type');
    assert.equal(
      contentType,
      'application/json; charset=utf-8',
      'fallback invalid payload should return JSON content-type',
    );
    const body = await response.json();
    assert.equal(body?.meta?.source, 'fallback');
    assert.equal(body?.meta?.stale, true);
    const errorCodes = Array.isArray(body?.errors) ? body.errors.map((err) => err.code) : [];
    assert(errorCodes.includes('aggregate_fallback_invalid'));
    assert(errorCodes.includes('fallback_invalid_json') || errorCodes.includes('fallback_empty_payload'));
  } finally {
    await stopServer(server);
    __resetAggregateOverrides();
    __resetLegacyBundleHandler();
  }
}

await testAggregateEndpointReturnsJson();
await testLegacyFallbackInvalidJson();

