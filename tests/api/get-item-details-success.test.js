const assert = require('assert');
const api = require('../../backend/api/index.js');

function createMockResponse(context = {}) {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    __responseContext: { ...context },
    writeHead(statusCode, incomingHeaders) {
      this.statusCode = statusCode;
      Object.assign(this.headers, incomingHeaders);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

async function run() {
  const context = {
    traceId: 'trace-item-success',
    ts: '2024-01-01T00:00:00.000Z',
  };
  const response = createMockResponse(context);

  const originalReadItemSnapshot = api.readItemSnapshot;
  api.readItemSnapshot = async (itemId, lang) => {
    if (lang === 'en') {
      return {
        item: { id: itemId, name: 'Item EN' },
        meta: {
          lang: 'en',
          source: 'cache',
          lastUpdated: '2024-01-02T00:00:00.000Z',
          stale: false,
        },
      };
    }
    return {
      item: { id: itemId, name: 'Item ES', icon: 'icon.png' },
      meta: {
        lang: 'es',
        source: 'cache',
        lastUpdated: '2024-01-01T00:00:00.000Z',
        stale: false,
      },
    };
  };

  const mongoStub = {
    db() {
      return {
        collection(name) {
          if (name === 'recipes') {
            return {
              find(filter) {
                return {
                  limit() {
                    return this;
                  },
                  async toArray() {
                    return [
                      {
                        id: 12345,
                        output_item_id: filter.output_item_id,
                        output_item_count: 3,
                        ingredients: [
                          { item_id: 100, count: 2, type: 'Item' },
                          { item_id: 200, count: 1, type: 'Item' },
                        ],
                        disciplines: ['Artificer'],
                        lang: 'es',
                        lastUpdated: new Date('2024-01-03T00:00:00.000Z'),
                      },
                    ];
                  },
                };
              },
            };
          }
          if (name === 'prices') {
            return {
              async findOne(filter) {
                return {
                  id: filter.id,
                  buy_price: 111,
                  sell_price: 222,
                  last_updated: '2024-01-04T00:00:00Z',
                  lastUpdated: new Date('2024-01-04T00:00:00Z'),
                  source: 'external',
                  lang: 'es',
                };
              },
            };
          }
          if (name === 'recipeTrees') {
            return {
              async findOne(filter) {
                return {
                  id: filter.id,
                  tree: [
                    {
                      id: filter.id + 1000,
                      name: 'Nested Blade',
                      icon: 'nested.png',
                      rarity: 'Rare',
                      count: 2,
                      buy_price: 10,
                      sell_price: 12,
                      children: [],
                      recipe: {
                        output_item_count: 1,
                        ingredients: [
                          { item_id: 77, count: 4 },
                        ],
                      },
                    },
                  ],
                  lastUpdated: new Date('2024-01-06T00:00:00.000Z'),
                };
              },
            };
          }
          throw new Error(`Unexpected collection ${name}`);
        },
      };
    },
  };
  api.__setMongoClient(mongoStub);

  const redisCalls = [];
  const redisStub = {
    isOpen: true,
    async hGet(hash, field) {
      redisCalls.push({ type: 'hGet', hash, field });
      return null;
    },
    async hSet(hash, field, value) {
      redisCalls.push({ type: 'hSet', hash, field, value: JSON.parse(value) });
      return 'OK';
    },
  };
  api.__setRedisClient(redisStub);

  try {
    await api.handleGetItem(response, 9876, 'es');
  } finally {
    api.readItemSnapshot = originalReadItemSnapshot;
    api.__resetMongoClient();
    api.__resetRedisClient();
  }

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(
    response.headers['Cache-Control'],
    'public, max-age=120, stale-while-revalidate=120',
  );

  const payload = JSON.parse(response.body);
  assert.ok(payload);
  assert.strictEqual(payload.meta.itemId, 9876);
  assert.strictEqual(payload.meta.lang, 'es');
  assert.strictEqual(payload.meta.source, 'cache');
  assert.strictEqual(payload.meta.lastUpdated, '2024-01-01T00:00:00.000Z');
  assert.strictEqual(payload.meta.stale, false);

  assert.deepStrictEqual(payload.data.item, {
    id: 9876,
    name: 'Item ES',
    icon: 'icon.png',
    name_en: 'Item EN',
  });
  assert.ok(payload.data.recipe);
  assert.strictEqual(payload.data.recipe.output_item_id, 9876);
  assert.strictEqual(payload.data.recipe.output_item_count, 3);
  assert.deepStrictEqual(payload.data.recipe.ingredients, [
    { item_id: 100, count: 2, type: 'Item' },
    { item_id: 200, count: 1, type: 'Item' },
  ]);
  assert.deepStrictEqual(payload.data.market, {
    id: 9876,
    buy_price: 111,
    sell_price: 222,
    last_updated: '2024-01-04T00:00:00Z',
    lastUpdated: '2024-01-04T00:00:00.000Z',
  });
  assert.deepStrictEqual(payload.data.nested_recipe, {
    tree: [
      {
        id: 10876,
        name: 'Nested Blade',
        icon: 'nested.png',
        rarity: 'Rare',
        count: 2,
        buy_price: 10,
        sell_price: 12,
        children: [],
        recipe: {
          output_item_count: 1,
          ingredients: [
            { item_id: 77, count: 4 },
          ],
        },
      },
    ],
    lastUpdated: '2024-01-06T00:00:00.000Z',
  });
  assert.strictEqual(payload.errors, undefined);

  assert.deepStrictEqual(redisCalls, [
    { type: 'hGet', hash: 'recipeTrees', field: '9876' },
    {
      type: 'hSet',
      hash: 'recipeTrees',
      field: '9876',
      value: {
        tree: [
          {
            id: 10876,
            name: 'Nested Blade',
            icon: 'nested.png',
            rarity: 'Rare',
            count: 2,
            buy_price: 10,
            sell_price: 12,
            children: [],
            recipe: {
              output_item_count: 1,
              ingredients: [
                { item_id: 77, count: 4 },
              ],
            },
          },
        ],
        lastUpdated: '2024-01-06T00:00:00.000Z',
      },
    },
  ]);

  console.log('tests/api/get-item-details-success.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
