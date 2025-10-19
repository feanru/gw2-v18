import assert from 'node:assert/strict';

function getFreshModuleId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function importService(suffix) {
  const modulePath = `../../src/js/services/donesAggregateService.js?${suffix}`;
  return import(modulePath);
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

async function testCacheReuse() {
  const suffix = getFreshModuleId('cache');
  let calls = 0;

  await withPatchedFetch(async (url) => {
    calls += 1;
    const urlString = String(url);
    if (!urlString.startsWith('/api/aggregate/bundle')) {
      throw new Error(`Unexpected URL ${urlString}`);
    }
    const payload = {
      priceMap: {
        1: { buy_price: 101, sell_price: 202 },
        2: { buy_price: 303, sell_price: 404 },
      },
      iconMap: {
        1: 'https://cdn.test/icon-1.png',
        2: 'https://cdn.test/icon-2.png',
      },
      rarityMap: {
        1: 'Legendario',
        2: 'Exótico',
      },
      itemMap: {
        1: { id: 1, name: 'Uno', icon: 'https://cdn.test/icon-1.png', rarity: 'Legendario' },
        2: { id: 2, name: 'Dos', icon: 'https://cdn.test/icon-2.png', rarity: 'Exótico' },
      },
      meta: { source: 'aggregate', stale: false, warnings: [] },
    };
    return {
      ok: true,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  }, async () => {
    const module = await importService(suffix);
    const { fetchDonesAggregate, __resetDonesAggregateCacheForTests } = module;
    await __resetDonesAggregateCacheForTests();
    const first = await fetchDonesAggregate([1, 2], { ttl: 60_000 });
    assert.equal(first.ok, true);
    assert.equal(first.partial, false);
    assert.equal(first.itemsMap.size, 2);
    assert.equal(first.pricesMap.size, 2);
    assert.equal(calls, 1);

    await withPatchedFetch(async () => {
      calls += 1;
      throw new Error('Fetch should not be called for cached request');
    }, async () => {
      const second = await fetchDonesAggregate([1, 2]);
      assert.equal(second.fromCache, true, 'Debe usar la cache en la segunda llamada');
      assert.equal(second.itemsMap.size, 2);
      assert.equal(second.pricesMap.size, 2);
    });

    assert.equal(calls, 1, 'La cache debe evitar llamadas adicionales');
  });
}

async function testPartialResponse() {
  const suffix = getFreshModuleId('partial');
  await withPatchedFetch(async () => {
    const payload = {
      priceMap: {
        5: { buy_price: 500, sell_price: 600 },
      },
      iconMap: {
        5: 'https://cdn.test/icon-5.png',
      },
      rarityMap: {
        5: 'Raro',
      },
      meta: { source: 'aggregate', stale: false, warnings: [] },
    };
    return {
      ok: true,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  }, async () => {
    const module = await importService(suffix);
    const { fetchDonesAggregate, __resetDonesAggregateCacheForTests } = module;
    await __resetDonesAggregateCacheForTests();
    const result = await fetchDonesAggregate([5, 6], { ttl: 10_000 });
    assert.equal(result.partial, true, 'Debe marcar la respuesta como parcial cuando faltan IDs');
    assert.ok(result.missingIds.includes(6), 'El ID faltante debe figurar en missingIds');
    assert.equal(result.itemsMap.has(5), true, 'Debe incluir los datos disponibles del agregado');
  });
}

async function testIconFallbackUsesString() {
  const suffix = getFreshModuleId('icon-fallback');
  const expectedIcon = 'https://cdn.test/icon-77.png';
  await withPatchedFetch(async () => {
    const payload = {
      priceMap: {},
      iconMap: {
        77: expectedIcon,
      },
      rarityMap: {},
      itemMap: {
        77: { id: 77, name: 'Setenta y siete' },
      },
      meta: { source: 'aggregate', stale: false, warnings: [] },
    };
    return {
      ok: true,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  }, async () => {
    const module = await importService(suffix);
    const { fetchDonesAggregate, __resetDonesAggregateCacheForTests } = module;
    await __resetDonesAggregateCacheForTests();
    const result = await fetchDonesAggregate([77], { ttl: 30_000 });
    const entry = result.itemsMap.get(77);
    assert.ok(entry, 'Debe existir la entrada normalizada');
    assert.equal(entry.icon, expectedIcon, 'Debe usar el icono proveniente del mapa');
    assert.equal(typeof entry.icon, 'string', 'El icono debe ser un string');

    const plainItems = Object.fromEntries(result.itemsMap.entries());
    assert.equal(plainItems['77'].icon, expectedIcon, 'La conversión a objeto debe conservar el string');
    assert.equal(typeof plainItems['77'].icon, 'string', 'El worker debe recibir iconos como string');
  });
}

async function testInvalidResponseThrows() {
  const suffix = getFreshModuleId('error');
  await withPatchedFetch(async () => ({
    ok: false,
    status: 503,
    headers: {
      get() {
        return 'application/json';
      },
    },
  }), async () => {
    const module = await importService(suffix);
    const { fetchDonesAggregate, __resetDonesAggregateCacheForTests } = module;
    await __resetDonesAggregateCacheForTests();
    let threw = false;
    try {
      await fetchDonesAggregate([10]);
    } catch (err) {
      threw = true;
      assert.match(String(err?.message || err), /503/);
    }
    assert.equal(threw, true, 'Debe propagar errores HTTP');
  });
}

async function testTtlRefresh() {
  const suffix = getFreshModuleId('ttl');
  let calls = 0;
  const responses = [
    {
      priceMap: { 11: { buy_price: 111, sell_price: 222 } },
      iconMap: { 11: 'https://cdn.test/icon-11.png' },
      rarityMap: { 11: 'Mítico' },
      meta: { source: 'aggregate', stale: false, warnings: [] },
    },
    {
      priceMap: { 11: { buy_price: 333, sell_price: 444 } },
      iconMap: { 11: 'https://cdn.test/icon-11b.png' },
      rarityMap: { 11: 'Legendario' },
      meta: { source: 'aggregate', stale: false, warnings: [] },
    },
  ];

  await withPatchedFetch(async () => {
    const payload = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return {
      ok: true,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  }, async () => {
    const module = await importService(suffix);
    const { fetchDonesAggregate, __resetDonesAggregateCacheForTests } = module;
    await __resetDonesAggregateCacheForTests();
    const first = await fetchDonesAggregate([11], { ttl: 1 });
    assert.equal(first.pricesMap.get(11)?.buy_price, 111);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await fetchDonesAggregate([11], { ttl: 1, skipCache: true });
    assert.equal(second.pricesMap.get(11)?.buy_price, 333, 'Debe refrescar tras expirar el TTL');
    assert.ok(calls >= 2, 'Debe realizar otra petición tras expirar el TTL');
  });
}

async function testTtlRefreshWithMissingIds() {
  const suffix = getFreshModuleId('ttl-missing');
  let calls = 0;
  const responses = [
    {
      priceMap: {
        21: { buy_price: 210, sell_price: 220 },
        22: { buy_price: 221, sell_price: 231 },
      },
      iconMap: {
        21: 'https://cdn.test/icon-21.png',
        22: 'https://cdn.test/icon-22.png',
      },
      rarityMap: {
        21: 'Ascendido',
        22: 'Ascendido',
      },
      itemMap: {
        21: { id: 21, name: 'Veintiuno' },
        22: { id: 22, name: 'Veintidós' },
      },
      meta: { source: 'aggregate', stale: false, warnings: [] },
    },
    {
      priceMap: {
        21: { buy_price: 310, sell_price: 320 },
      },
      iconMap: {
        21: 'https://cdn.test/icon-21b.png',
      },
      rarityMap: {
        21: 'Legendario',
      },
      itemMap: {
        21: { id: 21, name: 'Veintiuno reforjado' },
      },
      meta: { source: 'aggregate', stale: false, warnings: [] },
    },
  ];

  await withPatchedFetch(async () => {
    const payload = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return {
      ok: true,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  }, async () => {
    const module = await importService(suffix);
    const { fetchDonesAggregate, __resetDonesAggregateCacheForTests } = module;
    await __resetDonesAggregateCacheForTests();

    const first = await fetchDonesAggregate([21, 22], { ttl: 1 });
    assert.equal(first.partial, false, 'La respuesta inicial debe ser completa');
    assert.equal(first.itemsMap.size, 2);
    assert.equal(first.pricesMap.size, 2);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await fetchDonesAggregate([21, 22], { ttl: 1 });
    assert.equal(second.fromCache, false, 'Debe refrescar tras expirar el TTL');
    assert.equal(second.partial, true, 'Debe marcar partial cuando faltan IDs tras el refresh');
    assert.ok(second.missingIds.includes(22), 'Debe incluir el ID omitido en missingIds');
    assert.equal(second.itemsMap.has(22), false, 'No debe mantener datos antiguos para IDs omitidos');
    assert.ok(calls >= 2, 'Debe haber solicitado datos frescos al expirar el TTL');
  });
}

async function testPaginationRequests() {
  const suffix = getFreshModuleId('pagination');
  const fetchUrls = [];
  await withPatchedFetch(async (url) => {
    fetchUrls.push(String(url));
    const parsed = new URL(url, 'http://localhost');
    const page = Number(parsed.searchParams.get('page')) || 1;
    const pageSize = Number(parsed.searchParams.get('pageSize')) || 0;
    const fieldsParam = parsed.searchParams.get('fields');
    assert.ok(fieldsParam && fieldsParam.includes('priceMap'), 'Debe solicitar campos específicos');
    assert.equal(pageSize, 1, 'Debe respetar el pageSize solicitado');
    if (page === 1) {
      const payload = {
        priceMap: { 1: { buy_price: 101, sell_price: 202 } },
        iconMap: { 1: 'https://cdn.test/icon-1.png' },
        rarityMap: { 1: 'Legendario' },
        itemMap: { 1: { id: 1, name: 'Uno' } },
        meta: {
          source: 'aggregate',
          stale: false,
          warnings: [],
          pagination: {
            page: 1,
            pageSize: 1,
            totalIds: 2,
            totalPages: 2,
            hasNext: true,
            hasPrev: false,
          },
        },
      };
      return {
        ok: true,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
          },
        },
        async text() {
          return JSON.stringify(payload);
        },
      };
    }
    if (page === 2) {
      const payload = {
        priceMap: { 2: { buy_price: 303, sell_price: 404 } },
        iconMap: { 2: 'https://cdn.test/icon-2.png' },
        rarityMap: { 2: 'Exótico' },
        itemMap: { 2: { id: 2, name: 'Dos' } },
        meta: {
          source: 'aggregate',
          stale: false,
          warnings: [],
          pagination: {
            page: 2,
            pageSize: 1,
            totalIds: 2,
            totalPages: 2,
            hasNext: false,
            hasPrev: true,
          },
        },
      };
      return {
        ok: true,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
          },
        },
        async text() {
          return JSON.stringify(payload);
        },
      };
    }
    throw new Error(`Página inesperada ${page}`);
  }, async () => {
    const module = await importService(suffix);
    const { fetchDonesAggregate, __resetDonesAggregateCacheForTests } = module;
    await __resetDonesAggregateCacheForTests();
    const result = await fetchDonesAggregate([1, 2], { ttl: 5_000, pageSize: 1 });
    assert.equal(result.itemsMap.size, 2, 'Debe combinar ambos lotes paginados');
    assert.equal(result.pricesMap.size, 2, 'Debe combinar los precios paginados');
    assert.equal(fetchUrls.length, 2, 'Debe realizar dos solicitudes');
    assert.ok(fetchUrls[0].includes('page=1'));
    assert.ok(fetchUrls[1].includes('page=2'));
  });
}

async function run() {
  await testCacheReuse();
  await testPartialResponse();
  await testIconFallbackUsesString();
  await testInvalidResponseThrows();
  await testTtlRefresh();
  await testTtlRefreshWithMissingIds();
  await testPaginationRequests();
  console.log('tests/frontend/dones-aggregate-service.test.mjs passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
