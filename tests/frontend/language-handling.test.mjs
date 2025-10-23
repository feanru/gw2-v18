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

function createNavigatorStub() {
  return {
    serviceWorker: {
      controller: { postMessage() {} },
      ready: Promise.resolve({ active: { postMessage() {} } }),
    },
  };
}

async function testAggregateServiceLanguageIsolation() {
  const moduleId = `aggregate-lang-${Date.now()}`;
  const { fetchItemAggregate, __clearAggregateItemCacheForTests } = await import(
    `../../src/js/services/aggregateService.js?${moduleId}`
  );

  await __clearAggregateItemCacheForTests();

  const originalRuntime = globalThis.__RUNTIME_CONFIG__;
  const originalNavigator = globalThis.navigator;
  globalThis.navigator = createNavigatorStub();
  try {
    let activeLang = 'es';
    globalThis.__RUNTIME_CONFIG__ = { LANG: activeLang };

    let callCount = 0;
    await withPatchedFetch(async (input, options = {}) => {
      callCount += 1;
      const url = new URL(input, 'http://localhost');
      const langParam = url.searchParams.get('lang');
      assert.equal(langParam, activeLang, 'la URL debe incluir el parámetro lang actual');
      const acceptHeader = options.headers?.get
        ? options.headers.get('Accept-Language')
        : options.headers?.['Accept-Language'];
      assert.equal(acceptHeader, activeLang, 'Debe enviar Accept-Language');

      const etag = `W/"etag-${activeLang}-${callCount}"`;
      return {
        status: 200,
        ok: true,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'content-type') return 'application/json';
            if (lower === 'etag') return etag;
            if (lower === 'last-modified') return 'Mon, 01 Jan 2024 00:00:00 GMT';
            if (lower === 'content-language') return activeLang;
            return null;
          },
        },
        async json() {
          return {
            data: {
              item: { id: 101, name: `Item-${activeLang}` },
            },
            meta: {
              lang: activeLang,
              source: 'aggregate',
              stale: false,
            },
          };
        },
      };
    }, async () => {
      const first = await fetchItemAggregate(101);
      assert.equal(first.fromCache, false, 'La primera respuesta no debe venir de cache');
      assert.equal(first.meta.lang, 'es');

      activeLang = 'en';
      globalThis.__RUNTIME_CONFIG__ = { LANG: activeLang };

      const second = await fetchItemAggregate(101);
      assert.equal(second.fromCache, false, 'Debe refetch al cambiar de idioma');
      assert.equal(second.meta.lang, 'en');
      assert.equal(callCount, 2, 'Debe haber una solicitud por cada idioma');
    });
  } finally {
    globalThis.__RUNTIME_CONFIG__ = originalRuntime;
    globalThis.navigator = originalNavigator;
    await __clearAggregateItemCacheForTests();
  }
}

async function testRecipeServiceLanguageIsolation() {
  const moduleId = `recipe-lang-${Date.now()}`;
  const recipeModule = await import(`../../src/js/services/recipeService.js?${moduleId}`);
  const { getItemBundles } = recipeModule;

  const originalRuntime = globalThis.__RUNTIME_CONFIG__;
  const originalNavigator = globalThis.navigator;
  globalThis.navigator = createNavigatorStub();
  try {
    let activeLang = 'es';
    globalThis.__RUNTIME_CONFIG__ = { LANG: activeLang };

    const responses = {
      es: {
        data: [
          {
            id: 555,
            item: { id: 555, name: 'Espada ES' },
            meta: { lang: 'es', warnings: [] },
          },
        ],
      },
      en: {
        data: [
          {
            id: 555,
            item: { id: 555, name: 'Sword EN' },
            meta: { lang: 'en', warnings: [] },
          },
        ],
      },
    };

    let callCount = 0;
    await withPatchedFetch(async (input, options = {}) => {
      const url = new URL(input, 'http://localhost');
      if (!url.pathname.includes('dataBundle.php')) {
        throw new Error(`Unexpected fetch ${url.href}`);
      }
      callCount += 1;
      const langParam = url.searchParams.get('lang');
      assert.equal(langParam, activeLang, 'la URL del bundle debe incluir lang');
      const acceptHeader = options.headers?.get
        ? options.headers.get('Accept-Language')
        : options.headers?.['Accept-Language'];
      assert.equal(acceptHeader, activeLang, 'Debe enviar Accept-Language en bundle');

      return {
        status: 200,
        ok: true,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'content-type') return 'application/json';
            if (lower === 'content-language') return activeLang;
            return null;
          },
        },
        async json() {
          return responses[activeLang];
        },
      };
    }, async () => {
      const first = await getItemBundles([555]);
      assert.equal(first[0].meta.lang, 'es');
      assert.equal(first[0].item.name, 'Espada ES');

      activeLang = 'en';
      globalThis.__RUNTIME_CONFIG__ = { LANG: activeLang };

      const second = await getItemBundles([555]);
      assert.equal(second[0].meta.lang, 'en');
      assert.equal(second[0].item.name, 'Sword EN');
      assert.equal(callCount, 2, 'Debe llamar una vez por idioma');
    });
  } finally {
    globalThis.__RUNTIME_CONFIG__ = originalRuntime;
    globalThis.navigator = originalNavigator;
  }
}

async function run() {
  await testAggregateServiceLanguageIsolation();
  await testRecipeServiceLanguageIsolation();
  console.log('tests/frontend/language-handling.test.mjs passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
