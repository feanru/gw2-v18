import assert from 'node:assert/strict';

function createSessionStorageMock() {
  const data = new Map();
  return {
    _data: data,
    get length() {
      return data.size;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
    key(index) {
      return Array.from(data.keys())[index] ?? null;
    },
  };
}

async function withPatchedFetch(stub, run) {
  const previousFetch = Object.prototype.hasOwnProperty.call(globalThis, 'fetch')
    ? globalThis.fetch
    : undefined;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
  }
}

async function withAggregateService(run) {
  const moduleId = `aggregate-fields-${Date.now()}-${Math.random()}`;
  let service;
  try {
    service = await import(`../../src/js/services/aggregateService.mjs?${moduleId}`);
  } catch (error) {
    console.error('Failed to import aggregate service module', error);
    throw error;
  }
  return run(service);
}

async function testFieldsQueryAndCacheKey(service) {
  service.__clearAggregateItemCacheForTests();
  const storage = createSessionStorageMock();
  globalThis.sessionStorage = storage;

  const etag = 'W/"fields-etag"';
  const lastModified = 'Tue, 05 Mar 2024 10:00:00 GMT';
  let callCount = 0;

  await withPatchedFetch(async (url, options = {}) => {
    callCount += 1;
    if (callCount === 1) {
      assert.ok(url.includes('/api/items/123/aggregate?fields=item%2Cmarket'));
      assert.ok(!options.headers || !('If-None-Match' in options.headers));
      return {
        status: 200,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'etag') return etag;
            if (lower === 'last-modified') return lastModified;
            if (lower === 'content-type') return 'application/json';
            return null;
          },
        },
        async json() {
          return {
            data: {
              item: { id: 123, name: 'Bolsa' },
              market: { unitBuyPrice: 42, unitSellPrice: 84 },
            },
            meta: { stale: false },
          };
        },
      };
    }

    assert.equal(options.headers['If-None-Match'], etag);
    assert.equal(options.headers['If-Modified-Since'], lastModified);
    return {
      status: 304,
      headers: {
        get(name) {
          const lower = String(name).toLowerCase();
          if (lower === 'etag') return etag;
          if (lower === 'last-modified') return lastModified;
          return null;
        },
      },
      async json() {
        throw new Error('No debe parsear JSON en 304');
      },
    };
  }, async () => {
    const first = await service.fetchItemAggregate(123, { fields: ['market', 'item'] });
    assert.equal(first.status, 200);
    assert.equal(first.fromCache, false);
    assert.equal(first.data.item.id, 123);

    const storedKey = Array.from(storage._data.keys()).find(key => key.includes('aggregate:item:123'));
    assert.equal(storedKey, 'aggregate:item:123:fields:item,market');

    const second = await service.fetchItemAggregate(123, { fields: ['item', 'market'] });
    assert.equal(second.status, 304);
    assert.equal(second.fromCache, true);
    assert.equal(second.data.item.id, 123);
    assert.equal(callCount, 2);
  });
}

async function testLegacyKeyMigration(service) {
  service.__clearAggregateItemCacheForTests();
  const storage = createSessionStorageMock();
  globalThis.sessionStorage = storage;

  const etag = '"legacy-etag"';
  const lastModified = 'Wed, 06 Mar 2024 12:00:00 GMT';
  storage.setItem(
    'aggregate:item:456',
    JSON.stringify({
      etag,
      lastModified,
      data: { item: { id: 456, name: 'Legacy' } },
      meta: { stale: false },
    }),
  );

  let callCount = 0;

  await withPatchedFetch(async (url, options = {}) => {
    callCount += 1;
    assert.ok(url.endsWith('/api/items/456/aggregate'));
    assert.equal(options.headers['If-None-Match'], etag);
    assert.equal(options.headers['If-Modified-Since'], lastModified);
    return {
      status: 304,
      headers: {
        get(name) {
          const lower = String(name).toLowerCase();
          if (lower === 'etag') return etag;
          if (lower === 'last-modified') return lastModified;
          return null;
        },
      },
      async json() {
        throw new Error('No debe parsear JSON en 304');
      },
    };
  }, async () => {
    const result = await service.fetchItemAggregate(456);
    assert.equal(result.status, 304);
    assert.equal(result.fromCache, true);
    assert.equal(result.data.item.id, 456);
  });

  assert.equal(callCount, 1);
  assert.ok(!storage._data.has('aggregate:item:456'));
  assert.ok(storage._data.has('aggregate:item:456:default'));
}

async function run() {
  await withAggregateService(async (service) => {
    await testFieldsQueryAndCacheKey(service);
    await testLegacyKeyMigration(service);
    service.__clearAggregateItemCacheForTests();
  });
  delete globalThis.sessionStorage;
  console.log('tests/frontend/aggregate-service-fields.test.mjs passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
