import assert from 'node:assert/strict';

async function testFetchItemPricesFallsBackToDataWars() {
  const previous = {
    window: Object.prototype.hasOwnProperty.call(globalThis, 'window')
      ? globalThis.window
      : undefined,
    fetch: Object.prototype.hasOwnProperty.call(globalThis, 'fetch')
      ? globalThis.fetch
      : undefined,
  };

  const fetchCalls = [];
  const aggregateUrlPrefix = '/api/aggregate/bundle';
  const datawarsUrlPrefix = 'https://api.datawars2.ie';

  globalThis.window = {};
  globalThis.fetch = async (url) => {
    const urlString = String(url);
    fetchCalls.push(urlString);
    if (urlString.startsWith(aggregateUrlPrefix)) {
      return {
        ok: false,
        status: 502,
        headers: {
          get(name) {
            if (String(name).toLowerCase() === 'content-type') {
              return 'application/json';
            }
            return null;
          },
        },
        async json() {
          return { errors: ['bad gateway'] };
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
          return 'id,buy_price,sell_price\n90401,1234,5678';
        },
      };
    }

    throw new Error(`Unexpected fetch for ${urlString}`);
  };

  await import(`../../src/js/bundle-fractales.js?test=${Date.now()}`);
  const utils = globalThis.window?.FractalesUtils;
  assert.ok(utils, 'FractalesUtils should be exposed in window');

  const prices = await utils.fetchItemPrices([90401]);
  assert.equal(prices instanceof Map, true, 'Debe devolver un Map');

  const entry = prices.get(90401);
  assert.ok(entry, 'El Map debe contener el ID solicitado');
  assert.equal(entry.buy_price, 1234);
  assert.equal(entry.sell_price, 5678);

  const aggregateCalls = fetchCalls.filter((url) => url.startsWith(aggregateUrlPrefix));
  const datawarsCalls = fetchCalls.filter((url) => url.startsWith(datawarsUrlPrefix));
  assert.equal(aggregateCalls.length, 1, 'Debe intentar consultar el agregado');
  assert.equal(datawarsCalls.length, 1, 'Debe caer al fallback de DataWars exactamente una vez');

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
  await testFetchItemPricesFallsBackToDataWars();
  console.log('tests/frontend/fetch-item-prices-fallback.test.mjs passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
