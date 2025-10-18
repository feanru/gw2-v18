const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');

const { ok, fail } = require('./index.js');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const mongo = new MongoClient(MONGO_URL);
const redis = createClient({ url: REDIS_URL });

async function init(mongoClient = mongo, redisClient = redis) {
  if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
    await mongoClient.connect();
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

async function getRecipeTree(id, { mongoClient = mongo, redisClient = redis } = {}) {
  await init(mongoClient, redisClient);
  const cache = await redisClient.hGet('recipeTrees', String(id));
  if (cache) return JSON.parse(cache);
  const doc = await mongoClient
    .db()
    .collection('recipeTrees')
    .findOne({ id: Number(id) }, { projection: { _id: 0 } });
  if (doc) {
    await redisClient.hSet('recipeTrees', String(id), JSON.stringify(doc));
  }
  return doc;
}

const RESPONSE_CONTEXT_KEY = '__responseContext';

function generateTraceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function ensureResponseContext(res) {
  if (!res || typeof res !== 'object') {
    return;
  }
  if (!res[RESPONSE_CONTEXT_KEY]) {
    res[RESPONSE_CONTEXT_KEY] = {
      traceId: generateTraceId(),
      ts: new Date().toISOString(),
    };
  } else {
    const context = res[RESPONSE_CONTEXT_KEY];
    if (!context.traceId) {
      context.traceId = generateTraceId();
    }
    if (!context.ts) {
      context.ts = new Date().toISOString();
    }
  }
}

function normalizeId(rawId) {
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function handler(req, res, clients) {
  ensureResponseContext(res);
  const rawId = (req.params && req.params.id) || req.url.split('/').pop();
  const id = normalizeId(rawId);
  if (!id) {
    fail(res, 400, 'errorInvalidId', 'Recipe id must be a positive integer');
    return;
  }
  try {
    const tree = await getRecipeTree(id, clients);
    if (!tree) {
      fail(res, 404, 'errorNotFound', 'Recipe tree not found');
      return;
    }
    const meta = {};
    if (tree.lastUpdated) {
      meta.lastUpdated = tree.lastUpdated;
    }
    ok(res, tree, meta);
  } catch (err) {
    fail(
      res,
      500,
      'errorUnexpected',
      'Unexpected error retrieving recipe tree',
      {},
      err && err.message ? { code: 'errorUnexpected', msg: err.message } : null,
    );
  }
}

module.exports = (req, res, clients) => handler(req, res, clients);
module.exports.getRecipeTree = (id, clients) => getRecipeTree(id, clients);

if (require.main === module) {
  const http = require('http');
  init()
    .then(() => {
      const server = http.createServer((req, res) => {
        ensureResponseContext(res);
        if (req.method === 'GET' && req.url.startsWith('/recipe-tree/')) {
          handler(req, res);
        } else {
          fail(res, 404, 'errorNotFound', 'Endpoint not found');
        }
      });
      const PORT = process.env.PORT || 3000;
      server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
