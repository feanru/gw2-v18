import assert from 'node:assert/strict';

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

async function testAggregateRevalidation304() {
  const moduleId = `aggregate-service-${Date.now()}`;
  const { fetchItemAggregate, __clearAggregateItemCacheForTests } = await import(
    `../../src/js/services/aggregateService.js?${moduleId}`
  );

  await __clearAggregateItemCacheForTests();

  let callCount = 0;
  const etagValue = 'W/"etag-123"';
  const lastModifiedValue = 'Mon, 01 Jan 2024 00:00:00 GMT';

  await withPatchedFetch(async (url, options = {}) => {
    callCount += 1;
    if (callCount === 1) {
      assert.ok(!options.headers || !('If-None-Match' in options.headers), 'Primer request sin If-None-Match');
      return {
        status: 200,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'content-type') return 'application/json';
            if (lower === 'etag') return etagValue;
            if (lower === 'last-modified') return lastModifiedValue;
            return null;
          },
        },
        async json() {
          return {
            data: {
              item: { id: 1001, name: 'Espada' },
              totals: { unitBuyPrice: 100, unitSellPrice: 200 },
            },
            meta: { lang: 'es', source: 'aggregate', stale: false },
          };
        },
      };
    }

    assert.ok(options.headers, 'Debe enviar encabezados en revalidación');
    assert.equal(options.headers['If-None-Match'], etagValue, 'Debe incluir If-None-Match con el ETag previo');
    assert.equal(options.headers['If-Modified-Since'], lastModifiedValue, 'Debe incluir If-Modified-Since');

    return {
      status: 304,
      headers: {
        get(name) {
          const lower = String(name).toLowerCase();
          if (lower === 'etag') return etagValue;
          if (lower === 'last-modified') return lastModifiedValue;
          return null;
        },
      },
      async json() {
        throw new Error('No debe intentar parsear JSON en 304');
      },
    };
  }, async () => {
    const first = await fetchItemAggregate(1001);
    assert.equal(first.status, 200);
    assert.equal(first.fromCache, false);
    assert.equal(first.data.item.id, 1001);
    assert.equal(first.model.item.id, 1001);
    assert.equal(first.model.prices.unit.buy, 100);

    const second = await fetchItemAggregate(1001);
    assert.equal(second.status, 304, 'La segunda llamada debe devolver 304');
    assert.equal(second.fromCache, true, 'La segunda llamada debe salir del cache');
    assert.equal(second.data.item.id, 1001, 'Debe reutilizar los datos cacheados');
    assert.equal(second.model.item.id, 1001, 'El modelo debe provenir del cache');
    assert.equal(callCount, 2, 'Debe realizar exactamente dos solicitudes');
  });

  await __clearAggregateItemCacheForTests();
}

async function run() {
  await testAggregateRevalidation304();
  console.log('tests/frontend/item-aggregate-revalidation.test.mjs passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
