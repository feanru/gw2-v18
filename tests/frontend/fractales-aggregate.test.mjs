import assert from 'node:assert/strict';

// Estos tests documentan cómo simular ambos caminos (éxito y fallback)
// para las utilidades de Fractales. En cada caso stubbeamos `globalThis.fetch`
// antes de importar el bundle y luego verificamos qué rutas se consultan y
// cómo quedan los caches poblados.

async function testAggregateBundleHappyPath() {
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window')
      ? globalThis.window
      : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch')
      ? globalThis.fetch
      : undefined,
  };

  const fetchCalls = [];
  const ids = [101, 102];
  const aggregateUrlPrefix = '/api/aggregate/bundle';

  // Camino "verde": devolvemos un agregado válido y nunca caemos a los fallbacks.
  globalThis.window = {};
  globalThis.fetch = async (url) => {
    const urlString = String(url);
    fetchCalls.push(urlString);
    if (urlString.startsWith(aggregateUrlPrefix)) {
      const payload = {
        priceMap: {
          101: { buy_price: 111, sell_price: 222 },
          102: { buy_price: 333, sell_price: 444 },
        },
        iconMap: {
          101: 'https://example.com/icons/101.png',
          102: 'https://example.com/icons/102.png',
        },
        rarityMap: {
          101: 'Exótico',
          102: 'Raro',
        },
      };
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            if (String(name).toLowerCase() === 'content-type') {
              return 'application/json';
            }
            return null;
          },
        },
        async text() {
          return JSON.stringify(payload);
        },
      };
    }

    throw new Error(`Unexpected fetch for ${urlString}`);
  };

  const modulePath = `../../src/js/bundle-fractales.js?aggregate-success=${Date.now()}`;
  await import(modulePath);
  const utils = globalThis.window?.FractalesUtils;
  assert.ok(utils, 'FractalesUtils should be exposed in window');

  await utils.fetchIconsFor(ids);
  ids.forEach((id) => {
    assert.equal(utils.iconCache[id], `https://example.com/icons/${id}.png`);
    assert.equal(utils.rarityCache[id], id === 101 ? 'Exótico' : 'Raro');
  });

  const prices = await utils.fetchItemPrices(ids);
  assert.equal(prices instanceof Map, true, 'fetchItemPrices debe devolver un Map');
  assert.equal(prices.size, ids.length, 'El Map debe contener todos los IDs solicitados');
  ids.forEach((id) => {
    assert.ok(prices.has(id), `El Map debe incluir el ID ${id}`);
  });

  const aggregateCalls = fetchCalls.filter((url) => url.startsWith(aggregateUrlPrefix));
  assert.equal(aggregateCalls.length, 2, 'Debe consultar el agregado para iconos y precios');
  const fallbackCalls = fetchCalls.filter((url) => url.startsWith('https://'));
  assert.equal(fallbackCalls.length, 0, 'No debe usar rutas externas cuando el agregado responde');

  if (previous.window === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previous.window;
  }
  if (previous.fetch === undefined) {
    delete globalThis.fetch;
  } else {
    globalThis.fetch = previous.fetch;
  }
}

async function testAggregateBundleFallbacks() {
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window')
      ? globalThis.window
      : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch')
      ? globalThis.fetch
      : undefined,
  };

  const fetchCalls = [];
  const ids = [201, 202];
  const aggregateUrlPrefix = '/api/aggregate/bundle';
  const datawarsUrlPrefix = 'https://api.datawars2.ie';
  const gw2ItemsPrefix = 'https://api.guildwars2.com/v2/items';

  // Camino de fallback: el agregado falla y se deben usar las APIs públicas.
  globalThis.window = {};
  globalThis.fetch = async (url) => {
    const urlString = String(url);
    fetchCalls.push(urlString);
    if (urlString.startsWith(aggregateUrlPrefix)) {
      return {
        ok: false,
        status: 500,
        headers: {
          get() {
            return 'application/json';
          },
        },
      };
    }

    if (urlString.startsWith(gw2ItemsPrefix)) {
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            if (String(name).toLowerCase() === 'content-type') {
              return 'application/json';
            }
            return null;
          },
        },
        async json() {
          return [
            { id: 201, icon: 'https://fallback/icons/201.png', rarity: 'Legendario' },
            { id: 202, icon: 'https://fallback/icons/202.png', rarity: 'Ascendido' },
          ];
        },
      };
    }

    if (urlString.startsWith(datawarsUrlPrefix)) {
      return {
        ok: true,
        status: 200,
        headers: {
          get() {
            return 'text/csv';
          },
        },
        async text() {
          return 'id,buy_price,sell_price\n201,777,888\n202,999,1111';
        },
      };
    }

    throw new Error(`Unexpected fetch for ${urlString}`);
  };

  const modulePath = `../../src/js/bundle-fractales.js?aggregate-fallback=${Date.now()}`;
  await import(modulePath);
  const utils = globalThis.window?.FractalesUtils;
  assert.ok(utils, 'FractalesUtils debe exponerse en window');

  await utils.fetchIconsFor(ids);
  ids.forEach((id, index) => {
    assert.equal(utils.iconCache[id], `https://fallback/icons/${id}.png`);
    assert.equal(utils.rarityCache[id], index === 0 ? 'Legendario' : 'Ascendido');
  });

  const prices = await utils.fetchItemPrices(ids);
  assert.equal(prices instanceof Map, true, 'fetchItemPrices debe devolver un Map en fallback');
  assert.equal(prices.size, ids.length, 'El Map debe contener todos los IDs tras el fallback');
  ids.forEach((id) => {
    const entry = prices.get(id);
    assert.ok(entry, `Debe poblar el precio para ${id} vía DataWars`);
  });

  const aggregateCalls = fetchCalls.filter((url) => url.startsWith(aggregateUrlPrefix));
  assert.equal(aggregateCalls.length, 2, 'Debe intentar el agregado para iconos y precios antes de caer al fallback');
  const gw2Calls = fetchCalls.filter((url) => url.startsWith(gw2ItemsPrefix));
  assert.equal(gw2Calls.length, 1, 'Debe llamar a /v2/items una vez para poblar iconos/rareza');
  const datawarsCalls = fetchCalls.filter((url) => url.startsWith(datawarsUrlPrefix));
  assert.equal(datawarsCalls.length, 1, 'Debe llamar a DataWars para obtener precios cuando falla el agregado');

  if (previous.window === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previous.window;
  }
  if (previous.fetch === undefined) {
    delete globalThis.fetch;
  } else {
    globalThis.fetch = previous.fetch;
  }
}

async function run() {
  await testAggregateBundleHappyPath();
  await testAggregateBundleFallbacks();
  console.log('tests/frontend/fractales-aggregate.test.mjs passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
