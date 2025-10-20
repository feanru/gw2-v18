'use strict';

const Module = require('module');

let restoreFn = null;

function registerMockDeps() {
  if (restoreFn) {
    return restoreFn;
  }

  const originalLoad = Module._load;

  const redisState = createRedisState();

  function mockLoad(request, parent, isMain) {
    if (request === 'mongodb') {
      return { MongoClient: createMongoClientStub() };
    }
    if (request === 'redis') {
      return { createClient: () => createRedisClient(redisState) };
    }
    return originalLoad(request, parent, isMain);
  }

  Module._load = mockLoad;

  restoreFn = () => {
    if (Module._load === mockLoad) {
      Module._load = originalLoad;
    }
    restoreFn = null;
  };

  return restoreFn;
}

function createMongoClientStub() {
  return class MongoClientStub {
    constructor(url, options = {}) {
      this.url = url;
      this.options = options;
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
        collection() {
          return {
            async findOne() {
              return null;
            },
            find() {
              return {
                async toArray() {
                  return [];
                },
              };
            },
            async insertOne() {
              return { acknowledged: true, insertedId: null };
            },
            async updateOne() {
              return {
                acknowledged: true,
                matchedCount: 0,
                modifiedCount: 0,
                upsertedCount: 0,
              };
            },
            async aggregate() {
              return {
                async toArray() {
                  return [];
                },
              };
            },
            async deleteMany() {
              return { acknowledged: true, deletedCount: 0 };
            },
            async findOneAndUpdate() {
              return { value: null };
            },
            async findOneAndDelete() {
              return { value: null };
            },
          };
        },
      };
    }

    static async connect(url, options) {
      const client = new MongoClientStub(url, options);
      await client.connect();
      return client;
    }
  };
}

function createRedisState() {
  return {
    kv: new Map(),
    hashes: new Map(),
    sortedSets: new Map(),
    expirations: new Map(),
  };
}

function purgeExpired(state, key) {
  const expiresAt = state.expirations.get(key);
  if (expiresAt != null && Date.now() >= expiresAt) {
    state.expirations.delete(key);
    state.kv.delete(key);
    state.hashes.delete(key);
    state.sortedSets.delete(key);
  }
}

function normalizeScore(value) {
  if (value === '-inf') return -Infinity;
  if (value === '+inf') return Infinity;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function createRedisClient(state) {
  const client = {
    isOpen: false,
    on() {},
    async connect() {
      this.isOpen = true;
      return this;
    },
    async quit() {
      this.isOpen = false;
    },
    async duplicate() {
      return createRedisClient(state);
    },
    async get(key) {
      purgeExpired(state, key);
      return state.kv.has(key) ? state.kv.get(key) : null;
    },
    async set(key, value, options = {}) {
      state.kv.set(key, value);
      if (options.EX) {
        state.expirations.set(key, Date.now() + options.EX * 1000);
      } else if (options.PX) {
        state.expirations.set(key, Date.now() + options.PX);
      } else {
        state.expirations.delete(key);
      }
      return 'OK';
    },
    async setNX(key, value) {
      purgeExpired(state, key);
      if (state.kv.has(key)) {
        return false;
      }
      state.kv.set(key, value);
      return true;
    },
    async pExpire(key, ttl) {
      if (!state.kv.has(key)) {
        return 0;
      }
      state.expirations.set(key, Date.now() + ttl);
      return 1;
    },
    async exists(key) {
      purgeExpired(state, key);
      return state.kv.has(key) || state.hashes.has(key) || state.sortedSets.has(key) ? 1 : 0;
    },
    async del(...keys) {
      let count = 0;
      for (const key of keys) {
        purgeExpired(state, key);
        if (state.kv.delete(key) || state.hashes.delete(key) || state.sortedSets.delete(key)) {
          count += 1;
        }
        state.expirations.delete(key);
      }
      return count;
    },
    async eval(_script, { keys = [], arguments: args = [] } = {}) {
      const [key] = keys;
      purgeExpired(state, key);
      if (!key || !state.kv.has(key)) {
        return 0;
      }
      if (args.length && state.kv.get(key) === args[0]) {
        state.kv.delete(key);
        state.expirations.delete(key);
        return 1;
      }
      return 0;
    },
    async hGet(key, field) {
      purgeExpired(state, key);
      const hash = state.hashes.get(key);
      if (!hash) {
        return null;
      }
      return hash.has(field) ? hash.get(field) : null;
    },
    async hSet(key, field, value) {
      purgeExpired(state, key);
      let hash = state.hashes.get(key);
      if (!hash) {
        hash = new Map();
        state.hashes.set(key, hash);
      }
      hash.set(field, value);
      return 1;
    },
    async hDel(key, field) {
      purgeExpired(state, key);
      const hash = state.hashes.get(key);
      if (!hash) {
        return 0;
      }
      const deleted = hash.delete(field) ? 1 : 0;
      if (hash.size === 0) {
        state.hashes.delete(key);
      }
      return deleted;
    },
    async zAdd(key, entries = []) {
      purgeExpired(state, key);
      let set = state.sortedSets.get(key);
      if (!set) {
        set = [];
        state.sortedSets.set(key, set);
      }
      for (const { score, value } of entries) {
        const numericScore = Number(score);
        const existingIndex = set.findIndex((entry) => entry.value === value);
        if (existingIndex >= 0) {
          set[existingIndex] = { score: numericScore, value };
        } else {
          set.push({ score: numericScore, value });
        }
      }
      set.sort((a, b) => a.score - b.score);
      return entries.length;
    },
    async zRemRangeByScore(key, min, max) {
      purgeExpired(state, key);
      const set = state.sortedSets.get(key);
      if (!set) {
        return 0;
      }
      const minScore = normalizeScore(min);
      const maxScore = normalizeScore(max);
      const originalLength = set.length;
      const filtered = set.filter((entry) => entry.score < minScore || entry.score > maxScore);
      state.sortedSets.set(key, filtered);
      return originalLength - filtered.length;
    },
    async zCount(key, min, max) {
      purgeExpired(state, key);
      const set = state.sortedSets.get(key);
      if (!set) {
        return 0;
      }
      const minScore = normalizeScore(min);
      const maxScore = normalizeScore(max);
      return set.filter((entry) => entry.score >= minScore && entry.score <= maxScore).length;
    },
    multi() {
      const queue = [];
      return {
        hSet(key, field, value) {
          queue.push(() => client.hSet(key, field, value));
          return this;
        },
        hDel(key, field) {
          queue.push(() => client.hDel(key, field));
          return this;
        },
        async exec() {
          const results = [];
          for (const action of queue) {
            results.push(await action());
          }
          return results;
        },
      };
    },
  };

  return client;
}

module.exports = { registerMockDeps };
