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

async function testFetchAggregateBundleFields() {
  const iconCache = {};
  const rarityCache = {};
  const itemCache = {};
  let requestedUrl = null;

  await withPatchedFetch(async (url) => {
    requestedUrl = String(url);
    assert.ok(requestedUrl.includes('fields=priceMap%2CitemMap'), 'Debe solicitar itemMap en fields');
    assert.ok(requestedUrl.includes('page=2'), 'Debe propagar el parámetro page');
    assert.ok(requestedUrl.includes('pageSize=50'), 'Debe propagar el parámetro pageSize');
    const payload = {
      priceMap: { '101': { id: 101, buy_price: 123, sell_price: 456 } },
      iconMap: { '101': 'file/test.png' },
      rarityMap: { '101': 'Exotic' },
      itemMap: { '101': { id: 101, name: 'Test Item', type: 'Weapon', icon: 'file/test.png', rarity: 'Exotic' } },
      meta: { source: 'aggregate' },
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
    const { default: fetchAggregateBundle } = await import('../../src/js/utils/fetchAggregateBundle.js');
    const result = await fetchAggregateBundle([101], {
      iconCache,
      rarityCache,
      itemCache,
      fields: ['priceMap', 'itemMap'],
      page: 2,
      pageSize: 50,
    });
    assert.equal(result.priceMap.get(101).buy_price, 123);
    assert.equal(result.priceMap.get(101).sell_price, 456);
    assert.ok(result.itemMap.has(101), 'itemMap debe incluir el id solicitado');
    assert.equal(result.itemMap.get(101).name, 'Test Item');
    assert.equal(iconCache[101], 'file/test.png');
    assert.equal(rarityCache[101], 'Exotic');
    assert.deepEqual(itemCache[101], { id: 101, name: 'Test Item', type: 'Weapon', icon: 'file/test.png', rarity: 'Exotic' });
  });

  assert.ok(requestedUrl, 'La URL debe haberse solicitado');
}

async function testMissingDataThrows() {
  await withPatchedFetch(async () => ({
    ok: true,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    async text() {
      return JSON.stringify({ priceMap: {}, iconMap: {}, rarityMap: {} });
    },
  }), async () => {
    const { default: fetchAggregateBundle } = await import('../../src/js/utils/fetchAggregateBundle.js');
    let threw = false;
    try {
      await fetchAggregateBundle([1]);
    } catch (error) {
      threw = true;
      assert.match(error.message, /Datos incompletos/, 'Debe lanzar error cuando faltan datos');
    }
    assert.ok(threw, 'Debe fallar cuando el agregado no devuelve datos completos');
  });
}

async function run() {
  await testFetchAggregateBundleFields();
  await testMissingDataThrows();
  console.log('tests/frontend/fetch-aggregate-bundle-options.test.mjs passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
