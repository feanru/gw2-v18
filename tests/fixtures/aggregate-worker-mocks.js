'use strict';

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

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createMockMongoClient(sharedBuffer) {
  const counterView = sharedBuffer instanceof SharedArrayBuffer ? new Int32Array(sharedBuffer) : null;

  return class MockMongoClient {
    constructor() {
      this.connected = false;
    }

    async connect() {
      this.connected = true;
      return this;
    }

    async close() {
      this.connected = false;
    }

    db() {
      return {
        collection(name) {
          if (name === 'items') {
            return {
              async findOne(filter) {
                await sleep(40);
                const match = dataset.items.find(
                  (item) => item.id === filter.id && item.lang === filter.lang,
                );
                return match ? clone(match) : null;
              },
              find(filter) {
                return {
                  async toArray() {
                    await sleep(20);
                    const ids = Array.isArray(filter.id?.$in) ? filter.id.$in : [];
                    const langs = Array.isArray(filter.lang?.$in) ? filter.lang.$in : [];
                    return dataset.items
                      .filter((item) => ids.includes(item.id) && langs.includes(item.lang))
                      .map((item) => clone(item));
                  },
                };
              },
            };
          }
          if (name === 'recipeTrees') {
            return {
              async findOne(filter) {
                await sleep(60);
                if (filter.id === dataset.tree.id) {
                  if (counterView) {
                    Atomics.add(counterView, 0, 1);
                  }
                  return clone(dataset.tree);
                }
                return null;
              },
            };
          }
          if (name === 'prices') {
            return {
              async findOne(filter) {
                await sleep(10);
                const match = dataset.prices.find((price) => price.id === filter.id);
                return match ? clone(match) : null;
              },
              find(filter) {
                return {
                  async toArray() {
                    await sleep(10);
                    const ids = Array.isArray(filter.id?.$in) ? filter.id.$in : [];
                    return dataset.prices
                      .filter((price) => ids.includes(price.id))
                      .map((price) => clone(price));
                  },
                };
              },
            };
          }
          throw new Error(`Unknown collection ${name}`);
        },
      };
    }
  };
}

function createRedisMockState() {
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

  return {
    redisStore,
    redisExpiry,
    createClient() {
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
    },
  };
}

module.exports = {
  dataset,
  sleep,
  createMockMongoClient,
  createRedisMockState,
};
