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

  const firstAssignmentsHeader = JSON.stringify([
    {
      scope: 'aggregate',
      bucket: 'alpha',
      assignedAt: '2024-01-01T00:00:00.000Z',
      expiresAt: null,
      source: 'redis',
      feature: null,
      screen: null,
    },
  ]);
  const secondAssignmentsHeader = JSON.stringify([
    {
      scope: 'aggregate',
      bucket: 'beta',
      assignedAt: '2024-01-02T00:00:00.000Z',
      expiresAt: null,
      source: 'redis',
      feature: null,
      screen: null,
    },
  ]);

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
            if (lower === 'x-canary-assignments') return firstAssignmentsHeader;
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
    const ifNoneMatch =
      typeof options.headers.get === 'function'
        ? options.headers.get('If-None-Match')
        : options.headers['If-None-Match'];
    const ifModifiedSince =
      typeof options.headers.get === 'function'
        ? options.headers.get('If-Modified-Since')
        : options.headers['If-Modified-Since'];
    assert.equal(ifNoneMatch, etagValue, 'Debe incluir If-None-Match con el ETag previo');
    assert.equal(ifModifiedSince, lastModifiedValue, 'Debe incluir If-Modified-Since');

    return {
      status: 304,
      headers: {
        get(name) {
          const lower = String(name).toLowerCase();
          if (lower === 'etag') return etagValue;
          if (lower === 'last-modified') return lastModifiedValue;
          if (lower === 'x-canary-assignments') return secondAssignmentsHeader;
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
    assert.deepEqual(first.meta.canaryAssignments, JSON.parse(firstAssignmentsHeader));

    const second = await fetchItemAggregate(1001);
    assert.equal(second.status, 304, 'La segunda llamada debe devolver 304');
    assert.equal(second.fromCache, true, 'La segunda llamada debe salir del cache');
    assert.equal(second.data.item.id, 1001, 'Debe reutilizar los datos cacheados');
    assert.equal(second.model.item.id, 1001, 'El modelo debe provenir del cache');
    assert.deepEqual(second.meta.canaryAssignments, JSON.parse(secondAssignmentsHeader));
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
