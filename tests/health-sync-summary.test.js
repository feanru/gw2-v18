const assert = require('assert');

const now = Date.now();
const within24h = new Date(now - 6 * 60 * 60 * 1000);
const olderThan24h = new Date(now - 50 * 60 * 60 * 1000);

const statuses = {
  items: {
    lastSuccess: new Date(now - 5 * 60 * 1000),
    lastFailure: new Date(now - 2 * 60 * 60 * 1000),
    failures: [
      { at: within24h },
      { at: olderThan24h },
    ],
  },
  prices: {
    lastSuccess: new Date(now - 30 * 60 * 1000),
    failures: [],
  },
  recipes: {
    lastFailure: new Date(now - 30 * 60 * 1000),
    failures: [{ at: within24h }],
  },
  recipeTrees: {
    lastSuccess: new Date(now - 90 * 60 * 1000),
    failures: [],
  },
};

const collections = {
  items: { count: 10, lastUpdated: new Date(now - 15 * 60 * 1000) },
  prices: { count: 20, lastUpdated: null },
  recipes: { count: 30, lastUpdated: new Date(now - 2 * 60 * 60 * 1000) },
  recipeTrees: { count: 5, lastUpdated: new Date(now - 60 * 60 * 1000) },
};

const syncStatusPath = require.resolve('../backend/jobs/syncStatus.js');
require.cache[syncStatusPath] = {
  id: syncStatusPath,
  filename: syncStatusPath,
  loaded: true,
  exports: {
    getStatus: async (_client, name) => statuses[name] || null,
  },
};

const { buildSyncHealthPayload } = require('../backend/jobs/healthSummary.js');

function createCollectionStub(config) {
  return {
    async countDocuments() {
      return config.count;
    },
    find() {
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        async next() {
          if (!config.lastUpdated) {
            return null;
          }
          return { lastUpdated: config.lastUpdated };
        },
      };
    },
  };
}

const client = {
  db() {
    return {
      collection(name) {
        const config = collections[name];
        if (!config) {
          throw new Error(`Unexpected collection ${name}`);
        }
        return createCollectionStub(config);
      },
    };
  },
};

(async function run() {
  const payload = await buildSyncHealthPayload(client);
  const keys = Object.keys(payload).sort();
  assert.deepStrictEqual(keys, ['items', 'prices', 'recipeTrees', 'recipes']);

  const items = payload.items;
  assert.strictEqual(items.count, collections.items.count);
  assert.strictEqual(items.lastUpdated, collections.items.lastUpdated.toISOString());
  assert.strictEqual(items.failures24h, 1);
  assert.strictEqual(items.lastSuccessAt, statuses.items.lastSuccess.toISOString());
  assert.strictEqual(items.lastFailureAt, statuses.items.lastFailure.toISOString());

  const prices = payload.prices;
  assert.strictEqual(prices.count, collections.prices.count);
  assert.strictEqual(prices.lastUpdated, statuses.prices.lastSuccess.toISOString());
  assert.strictEqual(prices.failures24h, 0);
  assert.strictEqual(prices.lastSuccessAt, statuses.prices.lastSuccess.toISOString());
  assert.strictEqual(prices.lastFailureAt, null);

  const recipes = payload.recipes;
  assert.strictEqual(recipes.count, collections.recipes.count);
  assert.strictEqual(recipes.lastUpdated, collections.recipes.lastUpdated.toISOString());
  assert.strictEqual(recipes.failures24h, 1);
  assert.strictEqual(recipes.lastSuccessAt, null);
  assert.strictEqual(recipes.lastFailureAt, statuses.recipes.lastFailure.toISOString());

  const recipeTrees = payload.recipeTrees;
  assert.strictEqual(recipeTrees.count, collections.recipeTrees.count);
  assert.strictEqual(recipeTrees.lastUpdated, collections.recipeTrees.lastUpdated.toISOString());
  assert.strictEqual(recipeTrees.failures24h, 0);
  assert.strictEqual(recipeTrees.lastSuccessAt, statuses.recipeTrees.lastSuccess.toISOString());
  assert.strictEqual(recipeTrees.lastFailureAt, null);

  console.log('tests/health-sync-summary.test.js passed');
})();
