import assert from 'assert';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { registerMockDeps } = require('./helpers/register-mock-deps.js');
const restoreDeps = registerMockDeps();

const { getItemIconPlaceholderPath } = await import('../src/js/utils/iconPlaceholder.js');
const PLACEHOLDER_ICON_PATH = getItemIconPlaceholderPath();

function createStubResponse(status, body) {
  return {
    status,
    async text() {
      return body;
    },
  };
}

function createStubFetch(config) {
  const counters = new Map();
  const itemsData = {
    es: {
      1: { id: 1, name: 'Espada ancestral', icon: 'icon-1.png', rarity: 'Rare' },
      2: { id: 2, name: 'Escudo forjado', icon: null, rarity: 'Fine' },
    },
    en: {
      1: { id: 1, name: 'Ancient Sword', icon: 'icon-1.png', rarity: 'Rare' },
      2: { id: 2, name: 'Forged Shield', icon: null, rarity: 'Fine' },
    },
  };
  const recipeSearchMap = new Map([
    [1, [501]],
    [2, [502]],
  ]);
  const recipeData = {
    501: {
      id: 501,
      output_item_count: 2,
      ingredients: [
        { item_id: 7, count: 3 },
      ],
    },
    502: {
      id: 502,
      output_item_count: 1,
      ingredients: [
        { item_id: 8, count: 5 },
      ],
    },
  };
  const nestedData = new Map([
    [1, { data: { tree: ['branch-1'] }, meta: { ok: true } }],
  ]);

  const itemsUrl = new URL(config.itemsEndpoint);
  const recipesUrl = new URL(config.recipesEndpoint);
  const recipesSearchUrl = new URL(config.recipesSearchEndpoint);
  const marketUrl = new URL(config.marketCsvUrl);
  const treeUrl = new URL(config.recipeTreeEndpoint);

  const record = (key) => {
    counters.set(key, (counters.get(key) || 0) + 1);
  };

  const fetchFn = async (input) => {
    const url = typeof input === 'string' ? input : input?.href || input?.url || String(input);
    const parsed = new URL(url);
    if (parsed.origin === itemsUrl.origin && parsed.pathname.startsWith(`${itemsUrl.pathname}/`)) {
      record('item');
      const id = Number.parseInt(parsed.pathname.substring(itemsUrl.pathname.length + 1), 10);
      const lang = (parsed.searchParams.get('lang') || config.defaultLang || 'es').toLowerCase();
      const langMap = itemsData[lang] || {};
      const data = langMap[id];
      if (!data) {
        return createStubResponse(404, '');
      }
      return createStubResponse(200, JSON.stringify(data));
    }

    if (parsed.origin === itemsUrl.origin && parsed.pathname === itemsUrl.pathname) {
      record('items');
      const ids = (parsed.searchParams.get('ids') || '')
        .split(',')
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
      const lang = (parsed.searchParams.get('lang') || config.defaultLang || 'es').toLowerCase();
      const langMap = itemsData[lang] || {};
      const payload = ids.map((id) => langMap[id]).filter((entry) => entry);
      return createStubResponse(200, JSON.stringify(payload));
    }

    if (parsed.origin === recipesSearchUrl.origin && parsed.pathname === recipesSearchUrl.pathname) {
      record('recipeSearch');
      const id = Number.parseInt(parsed.searchParams.get('output') || '0', 10);
      const mapped = recipeSearchMap.get(id) || [];
      return createStubResponse(200, JSON.stringify(mapped));
    }

    if (parsed.origin === recipesUrl.origin && parsed.pathname.startsWith(`${recipesUrl.pathname}/`)) {
      record('recipe');
      const id = Number.parseInt(parsed.pathname.substring(recipesUrl.pathname.length + 1), 10);
      const data = recipeData[id];
      if (!data) {
        return createStubResponse(404, '');
      }
      return createStubResponse(200, JSON.stringify(data));
    }

    if (parsed.origin === marketUrl.origin && parsed.pathname === marketUrl.pathname) {
      record('market');
      const ids = (parsed.searchParams.get('ids') || '')
        .split(',')
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
      if (ids.length === 1) {
        const id = ids[0];
        const row = `${id},100,200,10,20,1700000000,1,2,3,4,5,6,7,8`;
        const header = 'id,buy_price,sell_price,buy_quantity,sell_quantity,last_updated,1d_buy_sold,1d_sell_sold,2d_buy_sold,2d_sell_sold,7d_buy_sold,7d_sell_sold,1m_buy_sold,1m_sell_sold';
        return createStubResponse(200, `${header}\n${row}`);
      }
      const header = 'id,buy_price,sell_price';
      const rows = ids.map((id) => `${id},${id * 10},${id * 20}`).join('\n');
      return createStubResponse(200, `${header}\n${rows}`);
    }

    if (parsed.origin === treeUrl.origin && parsed.pathname.startsWith(`${treeUrl.pathname}/`)) {
      record('nested');
      const id = Number.parseInt(parsed.pathname.substring(treeUrl.pathname.length + 1), 10);
      const data = nestedData.get(id);
      if (!data) {
        return createStubResponse(404, '');
      }
      return createStubResponse(200, JSON.stringify(data));
    }

    throw new Error(`Unexpected fetch for URL: ${url}`);
  };

  fetchFn.getCount = (key) => counters.get(key) || 0;
  fetchFn.resetCounts = () => counters.clear();

  return fetchFn;
}

function httpRequest(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const apiModule = await import('../backend/api/index.js');
const apiListener = apiModule.default;
const { __setLegacyOverrides, __resetLegacyOverrides } = apiModule;

const legacyConfig = {
  defaultLang: 'es',
  cacheTtlFast: 90,
  itemsEndpoint: 'https://api.example.test/v2/items',
  recipesEndpoint: 'https://api.example.test/v2/recipes',
  recipesSearchEndpoint: 'https://api.example.test/v2/recipes/search',
  marketCsvUrl: 'https://market.example.test/v1/items/csv',
  recipeTreeEndpoint: 'https://tree.example.test/recipe-tree',
  featureFlags: {
    usePrecomputed: false,
    forceLocalOnly: false,
  },
};

const fetchStub = createStubFetch(legacyConfig);
__setLegacyOverrides({ fetchImpl: fetchStub, config: legacyConfig });

const server = http.createServer(apiListener);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

async function getJson(pathname) {
  const response = await httpRequest(port, pathname);
  let payload = null;
  if (response.body) {
    payload = JSON.parse(response.body);
  }
  return { ...response, payload };
}

try {
  fetchStub.resetCounts();
  const itemResponse = await getJson('/api/legacy/itemDetails.php?itemId=1&lang=es');
  assert.strictEqual(itemResponse.statusCode, 200, 'item details should succeed');
  assert.ok(itemResponse.payload, 'item details payload missing');
  assert.strictEqual(itemResponse.payload.meta.source, 'fallback');
  assert.strictEqual(itemResponse.payload.meta.lang, 'es');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(itemResponse.payload, 'errors') ||
      Array.isArray(itemResponse.payload.errors),
  );
  if (Array.isArray(itemResponse.payload.errors)) {
    assert.strictEqual(itemResponse.payload.errors.length, 0);
  }
  assert.strictEqual(itemResponse.payload.data.item.name, 'Espada ancestral');
  assert.strictEqual(itemResponse.payload.data.item.name_en, 'Ancient Sword');
  assert.strictEqual(itemResponse.payload.data.recipe.output_item_count, 2);
  assert.deepStrictEqual(itemResponse.payload.data.recipe.ingredients, [
    { item_id: 7, count: 3 },
  ]);
  assert.strictEqual(itemResponse.payload.data.market.id, 1);
  assert.strictEqual(itemResponse.payload.data.market.buy_price, 100);
  assert.strictEqual(itemResponse.payload.data.market.sell_price, 200);
  assert.deepStrictEqual(itemResponse.payload.data.nested_recipe, { tree: ['branch-1'] });
  assert.strictEqual(
    itemResponse.headers['cache-control'],
    `public, max-age=${legacyConfig.cacheTtlFast}, stale-while-revalidate=${legacyConfig.cacheTtlFast}`,
  );
  assert.strictEqual(fetchStub.getCount('nested'), 1, 'nested fetch should be invoked once');

  const nullIconResponse = await getJson('/api/legacy/itemDetails.php?itemId=2&lang=es');
  assert.strictEqual(nullIconResponse.statusCode, 200, 'item with null icon should succeed');
  assert.ok(nullIconResponse.payload?.data?.item, 'Item payload should be present');
  assert.strictEqual(nullIconResponse.payload.data.item.icon, null, 'Icon should remain null in payload');
  assert.strictEqual(nullIconResponse.payload.data.item.iconFallback, true, 'Fallback flag should be true when icon is null');
  assert.strictEqual(
    nullIconResponse.payload.data.item.iconPlaceholder,
    PLACEHOLDER_ICON_PATH,
    'Placeholder path should be provided when icon is null',
  );

  fetchStub.resetCounts();
  const localResponse = await getJson('/api/legacy/itemDetails.php?itemId=1&ff=forceLocalOnly:true');
  assert.strictEqual(localResponse.statusCode, 200, 'force local request should succeed');
  assert.strictEqual(localResponse.payload.meta.source, 'local');

  fetchStub.resetCounts();
  const precomputedResponse = await getJson('/api/legacy/itemDetails.php?itemId=1&ff=usePrecomputed:true');
  assert.strictEqual(precomputedResponse.statusCode, 200, 'precomputed request should succeed');
  assert.strictEqual(precomputedResponse.payload.meta.source, 'fallback');
  assert.strictEqual(fetchStub.getCount('nested'), 0, 'nested fetch should be skipped when usePrecomputed=1');
  assert.strictEqual(precomputedResponse.payload.data.nested_recipe, null, 'nested data should be null when skipped');

  fetchStub.resetCounts();
  const notFoundResponse = await getJson('/api/legacy/itemDetails.php?itemId=999');
  assert.strictEqual(notFoundResponse.statusCode, 404, 'missing item should return 404');
  assert.strictEqual(notFoundResponse.payload.data, null);
  assert.strictEqual(notFoundResponse.payload.errors[0].code, 'aggregation_failed');
  assert.strictEqual(notFoundResponse.payload.errors[0].msg, 'Item not found');

  fetchStub.resetCounts();
  const bundleResponse = await getJson('/api/legacy/dataBundle.php?ids=1,2&lang=en');
  assert.strictEqual(bundleResponse.statusCode, 200, 'data bundle should succeed');
  assert.ok(Array.isArray(bundleResponse.payload.data));
  assert.strictEqual(bundleResponse.payload.data.length, 2);
  const [firstEntry, secondEntry] = bundleResponse.payload.data;
  assert.strictEqual(firstEntry.item.name_en, 'Ancient Sword');
  assert.strictEqual(secondEntry.item.name_en, 'Forged Shield');
  assert.strictEqual(firstEntry.item.iconFallback, false, 'First item should not mark fallback');
  assert.strictEqual(secondEntry.item.iconFallback, true, 'Second item should mark fallback');
  assert.strictEqual(
    secondEntry.item.iconPlaceholder,
    PLACEHOLDER_ICON_PATH,
    'Second item should expose placeholder path',
  );
  assert.ok(typeof firstEntry.extra.last_updated === 'number');
  assert.deepStrictEqual(firstEntry.recipe, {
    id: 501,
    output_item_count: 2,
    ingredients: [{ item_id: 7, count: 3 }],
  });
  assert.strictEqual(bundleResponse.headers['cache-control'], `public, max-age=${legacyConfig.cacheTtlFast}, stale-while-revalidate=${legacyConfig.cacheTtlFast}`);

  const missingIdsResponse = await getJson('/api/legacy/dataBundle.php');
  assert.strictEqual(missingIdsResponse.statusCode, 400, 'ids are required');
  assert.strictEqual(missingIdsResponse.payload.errors[0].code, 'ids_required');

  const nginxPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'nginx.conf');
  const nginxConfig = await fs.readFile(nginxPath, 'utf8');
  assert.ok(
    nginxConfig.includes('location ~ ^/backend/api/(itemDetails|dataBundle)\\.php$'),
    'nginx redirect block missing',
  );
  assert.ok(
    nginxConfig.includes('return 308 /api/legacy/$1.php$is_args$args;'),
    'nginx 308 redirect missing',
  );
  assert.ok(nginxConfig.includes('location /backend/api/ {'), 'nginx backend proxy block missing');
  assert.ok(
    nginxConfig.includes('proxy_pass http://127.0.0.1:3300/api/;'),
    'nginx proxy_pass for backend API missing',
  );
  assert.ok(nginxConfig.includes('location /api/ {'), 'nginx api proxy block missing');
  assert.ok(
    nginxConfig.includes('proxy_pass http://127.0.0.1:3300;'),
    'nginx proxy_pass for /api missing or incorrect',
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  __resetLegacyOverrides();
  if (typeof restoreDeps === 'function') {
    restoreDeps();
  }
}

console.log('tests/legacy-api.test.mjs passed');
