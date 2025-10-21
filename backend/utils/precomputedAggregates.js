'use strict';

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const COLLECTION_NAME = process.env.PRECOMPUTED_AGGREGATES_COLLECTION || 'aggregateSnapshots';
const DEFAULT_SOFT_TTL_SECONDS = normalizePositiveInt(
  process.env.PRECOMPUTED_AGGREGATE_SOFT_TTL,
  normalizePositiveInt(process.env.AGGREGATE_SOFT_TTL || process.env.CACHE_TTL_FAST, 600),
);
const DEFAULT_HARD_TTL_SECONDS = Math.max(
  normalizePositiveInt(process.env.PRECOMPUTED_AGGREGATE_HARD_TTL, 0),
  DEFAULT_SOFT_TTL_SECONDS,
);

let clientPromise = null;
let clientInstance = null;
let collectionPromise = null;

function normalizePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

async function getClient() {
  if (clientInstance && clientInstance.topology?.isConnected()) {
    return clientInstance;
  }
  if (clientPromise) {
    return clientPromise;
  }
  const client = new MongoClient(MONGO_URL, {
    maxPoolSize: 4,
    ignoreUndefined: true,
    serverSelectionTimeoutMS: normalizePositiveInt(
      process.env.PRECOMPUTED_MONGO_TIMEOUT_MS,
      750,
    ),
  });
  clientPromise = client
    .connect()
    .then(() => {
      clientInstance = client;
      return clientInstance;
    })
    .catch((err) => {
      clientPromise = null;
      clientInstance = null;
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[precomputed] failed to connect mongo: ${err.message}`);
      }
      throw err;
    });
  return clientPromise;
}

async function getCollection(providedClient) {
  if (collectionPromise && !providedClient) {
    return collectionPromise;
  }
  const resolver = async () => {
    const client = providedClient || (await getClient());
    const collection = client.db().collection(COLLECTION_NAME);
    await collection.createIndex({ itemId: 1, lang: 1 }, { unique: true });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });
    return collection;
  };
  if (!providedClient) {
    collectionPromise = resolver();
    return collectionPromise;
  }
  return resolver();
}

function markPrecomputedMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return { precomputed: true };
  }
  return { ...meta, precomputed: true };
}

function computeExpiresAt(storedAt, hardTtlSeconds) {
  if (!Number.isFinite(hardTtlSeconds) || hardTtlSeconds <= 0) {
    return null;
  }
  return new Date(storedAt.getTime() + hardTtlSeconds * 1000);
}

function isStale(storedAt, softTtlSeconds, now = Date.now()) {
  if (!(storedAt instanceof Date) || Number.isNaN(storedAt.getTime())) {
    return false;
  }
  if (!Number.isFinite(softTtlSeconds) || softTtlSeconds <= 0) {
    return false;
  }
  return now >= storedAt.getTime() + softTtlSeconds * 1000;
}

async function savePrecomputedAggregate({
  client,
  itemId,
  lang,
  payload,
  softTtlSeconds = DEFAULT_SOFT_TTL_SECONDS,
  hardTtlSeconds = DEFAULT_HARD_TTL_SECONDS,
}) {
  const numericId = Number(itemId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new Error('Invalid itemId for precomputed aggregate');
  }
  const normalizedLang = typeof lang === 'string' && lang.trim() ? lang.trim() : 'es';
  const collection = await getCollection(client);
  const storedAt = new Date();
  const expiresAt = computeExpiresAt(storedAt, hardTtlSeconds);
  const meta = markPrecomputedMeta(payload?.meta);
  const document = {
    itemId: numericId,
    lang: normalizedLang,
    payload: { ...payload, meta },
    softTtlSeconds: Number.isFinite(softTtlSeconds) && softTtlSeconds > 0 ? Math.floor(softTtlSeconds) : null,
    hardTtlSeconds: Number.isFinite(hardTtlSeconds) && hardTtlSeconds > 0 ? Math.floor(hardTtlSeconds) : null,
    storedAt,
    updatedAt: storedAt,
    expiresAt: expiresAt || null,
    precomputed: true,
  };
  await collection.updateOne(
    { itemId: numericId, lang: normalizedLang },
    { $set: document, $setOnInsert: { createdAt: storedAt } },
    { upsert: true },
  );
  return document.payload;
}

async function getPrecomputedAggregate({ client, itemId, lang }) {
  const numericId = Number(itemId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return null;
  }
  const normalizedLang = typeof lang === 'string' && lang.trim() ? lang.trim() : 'es';
  const collection = await getCollection(client);
  const doc = await collection.findOne({ itemId: numericId, lang: normalizedLang });
  if (!doc || !doc.payload) {
    return null;
  }
  const payload = { ...doc.payload, meta: markPrecomputedMeta(doc.payload.meta) };
  const now = Date.now();
  const stale = isStale(doc.storedAt, doc.softTtlSeconds, now);
  const expired = doc.hardTtlSeconds && doc.storedAt instanceof Date
    ? now >= doc.storedAt.getTime() + doc.hardTtlSeconds * 1000
    : false;
  if (expired) {
    return { payload, stale: true, expired: true };
  }
  return {
    payload,
    stale,
    expired: false,
    storedAt: doc.storedAt || null,
    softTtlSeconds: doc.softTtlSeconds || null,
    hardTtlSeconds: doc.hardTtlSeconds || null,
  };
}

async function close() {
  if (clientInstance) {
    try {
      await clientInstance.close();
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[precomputed] failed to close mongo: ${err.message}`);
      }
    }
  }
  clientInstance = null;
  clientPromise = null;
  collectionPromise = null;
}

module.exports = {
  savePrecomputedAggregate,
  getPrecomputedAggregate,
  close,
  DEFAULT_SOFT_TTL_SECONDS,
  DEFAULT_HARD_TTL_SECONDS,
};
