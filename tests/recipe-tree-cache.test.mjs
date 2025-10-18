import assert from 'assert'
import recipeTree from '../backend/api/recipeTree.js'

class MockMongo {
  constructor(doc) {
    this.doc = doc
    this.findCalls = 0
  }
  get topology() {
    return { isConnected: () => true }
  }
  async connect() {}
  db() {
    return {
      collection: () => ({
        findOne: async () => {
          this.findCalls += 1
          return this.doc
        },
      }),
    }
  }
}

class MockRedis {
  constructor() {
    this.store = new Map()
    this.hGetCalls = 0
    this.hSetCalls = 0
  }
  get isOpen() {
    return true
  }
  async connect() {}
  async hGet(hash, key) {
    this.hGetCalls += 1
    return this.store.get(key) || null
  }
  async hSet(hash, key, value) {
    this.hSetCalls += 1
    this.store.set(key, value)
  }
}

const { getRecipeTree } = recipeTree

const doc = { id: 42, nodes: [] }
const mongo = new MockMongo(doc)
const redis = new MockRedis()

const first = await getRecipeTree(42, { mongoClient: mongo, redisClient: redis })
assert.deepStrictEqual(first, doc)
assert.equal(mongo.findCalls, 1)
assert.equal(redis.hSetCalls, 1)

const second = await getRecipeTree(42, { mongoClient: mongo, redisClient: redis })
assert.deepStrictEqual(second, doc)
assert.equal(mongo.findCalls, 1)
assert.equal(redis.hGetCalls >= 2, true)

console.log('recipe-tree-cache test passed')
