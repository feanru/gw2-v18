const assert = require('assert');

process.env.NODE_ENV = 'test';

const dataset = {
  items: [
    {
      id: 1001,
      lang: 'es',
      name: 'Test Item',
      icon: 'icon.png',
      rarity: 'Rare',
      lastUpdated: new Date('2024-01-01T00:00:00Z'),
    },
    {
      id: 2002,
      lang: 'es',
      name: 'Component Item',
      icon: 'component.png',
      rarity: 'Basic',
      lastUpdated: new Date('2024-01-01T00:00:00Z'),
    },
  ],
  tree: {
    id: 1001,
    type: 'Recipe',
    quantity: 1,
    output: 1,
    components: [
      {
        id: 2002,
        type: 'Item',
        quantity: 3,
      },
    ],
  },
  prices: [
    { id: 1001, buy_price: 100, sell_price: 160 },
    { id: 2002, buy_price: 5, sell_price: 9 },
  ],
};

const observedOptions = [];

async function runScenario({ preference, expected }) {
  observedOptions.length = 0;

  if (typeof preference === 'undefined') {
    delete process.env.MONGO_READ_PREFERENCE;
  } else {
    process.env.MONGO_READ_PREFERENCE = preference;
  }

  const redisStore = new Map();
  const redisExpiry = new Map();

  function purgeExpired(key) {
    if (!redisExpiry.has(key)) {
      return;
    }
    const expiresAt = redisExpiry.get(key);
    if (expiresAt && expiresAt <= Date.now()) {
      redisExpiry.delete(key);
      redisStore.delete(key);
    }
  }

  class MockMongoClient {
    constructor(url, options = {}) {
      this.url = url;
      this.options = options;
      this.connected = false;
      observedOptions.push({ url, options });
    }

    async connect() {
      this.connected = true;
      return this;
    }

    db() {
      return {
        collection(name) {
          if (name === 'items') {
            return {
              async findOne(filter) {
                return (
                  dataset.items.find(
                    (item) => item.id === filter.id && item.lang === filter.lang,
                  ) || null
                );
              },
              find(filter) {
                return {
                  async toArray() {
                    const ids = Array.isArray(filter.id?.$in) ? filter.id.$in : [];
                    const langs = Array.isArray(filter.lang?.$in) ? filter.lang.$in : [];
                    return dataset.items
                      .filter((item) => ids.includes(item.id) && langs.includes(item.lang))
                      .map((item) => ({ ...item }));
                  },
                };
              },
            };
          }
          if (name === 'recipeTrees') {
            return {
              async findOne(filter) {
                if (filter.id === dataset.tree.id) {
                  return JSON.parse(JSON.stringify(dataset.tree));
                }
                return null;
              },
            };
          }
          if (name === 'prices') {
            return {
              async findOne(filter) {
                return dataset.prices.find((price) => price.id === filter.id) || null;
              },
              find(filter) {
                return {
                  async toArray() {
                    const ids = Array.isArray(filter.id?.$in) ? filter.id.$in : [];
                    return dataset.prices
                      .filter((price) => ids.includes(price.id))
                      .map((price) => ({ ...price }));
                  },
                };
              },
            };
          }
          throw new Error(`Unknown collection ${name}`);
        },
      };
    }
  }

  function createRedisClient() {
    return {
      isOpen: false,
      on() {},
      async connect() {
        this.isOpen = true;
        return this;
      },
      async get(key) {
        purgeExpired(key);
        return redisStore.has(key) ? redisStore.get(key) : null;
      },
      async set(key, value, options = {}) {
        redisStore.set(key, value);
        if (options.EX) {
          redisExpiry.set(key, Date.now() + options.EX * 1000);
        } else {
          redisExpiry.delete(key);
        }
        return 'OK';
      },
      async setNX(key, value) {
        purgeExpired(key);
        if (redisStore.has(key)) {
          return false;
        }
        redisStore.set(key, value);
        return true;
      },
      async pExpire(key, ttl) {
        if (!redisStore.has(key)) {
          return 0;
        }
        redisExpiry.set(key, Date.now() + ttl);
        return 1;
      },
      async exists(key) {
        purgeExpired(key);
        return redisStore.has(key) ? 1 : 0;
      },
      async del(key) {
        const existed = redisStore.delete(key);
        redisExpiry.delete(key);
        return existed ? 1 : 0;
      },
      async eval(script, { keys, arguments: args }) {
        const key = keys[0];
        purgeExpired(key);
        const expected = args[0];
        if (redisStore.get(key) === expected) {
          await this.del(key);
          return 1;
        }
        return 0;
      },
    };
  }

  const mongoPath = require.resolve('mongodb');
  require.cache[mongoPath] = { exports: { MongoClient: MockMongoClient } };

  const redisPath = require.resolve('redis');
  require.cache[redisPath] = { exports: { createClient: createRedisClient } };

  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
  const aggregateModule = require('../backend/aggregates/buildItemAggregate.js');

  const result = await aggregateModule.buildItemAggregate(1001, 'es');

  assert.strictEqual(result.meta.itemId, 1001);
  assert.ok(observedOptions.length >= 1, 'expected MongoClient to be instantiated');
  assert.strictEqual(
    observedOptions[0].options.readPreference,
    expected,
    'readPreference should match expectation',
  );
}

async function run() {
  await runScenario({ expected: 'secondaryPreferred' });
  await runScenario({ preference: 'primary', expected: 'primary' });

  delete process.env.MONGO_READ_PREFERENCE;

  console.log('tests/mongo-read-preference.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
