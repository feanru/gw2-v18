'use strict';

const { createClient } = require('redis');

const DEFAULT_MEMORY_SOFT_TTL_MS = normalizePositiveInt(
  process.env.SNAPSHOT_CACHE_SOFT_TTL_MS,
  Math.max(5_000, Number(process.env.SNAPSHOT_CACHE_SOFT_TTL_SECONDS || 0) * 1000) || 15_000,
);
const DEFAULT_MEMORY_HARD_TTL_MS = normalizePositiveInt(
  process.env.SNAPSHOT_CACHE_HARD_TTL_MS,
  Math.max(DEFAULT_MEMORY_SOFT_TTL_MS * 4, DEFAULT_MEMORY_SOFT_TTL_MS + 30_000),
);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClientPromise = null;
let redisClient = null;
const localCache = new Map();

function normalizePositiveInt(value, fallback) {
  if (value == null) {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function normalizeKey(key) {
  if (typeof key === 'string') {
    const trimmed = key.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  throw new TypeError('snapshotCache: key must be a non-empty string');
}

function toMs(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'string' && /s$/.test(value)) {
    const numeric = Number(value.slice(0, -1));
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric * 1000);
    }
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function createEnvelope(value, options = {}) {
  const now = Date.now();
  const softTtlMs = toMs(
    options.softTtlMs != null ? options.softTtlMs : options.softTtlSeconds != null
      ? options.softTtlSeconds * 1000
      : null,
    DEFAULT_MEMORY_SOFT_TTL_MS,
  );
  const hardTtlMs = Math.max(
    toMs(
      options.hardTtlMs != null ? options.hardTtlMs : options.hardTtlSeconds != null
        ? options.hardTtlSeconds * 1000
        : null,
      DEFAULT_MEMORY_HARD_TTL_MS,
    ),
    softTtlMs,
  );
  const expiresAt = Number.isFinite(hardTtlMs) ? now + hardTtlMs : null;
  const staleAt = Number.isFinite(softTtlMs) ? now + softTtlMs : null;
  const tags = Array.isArray(options.tags) ? options.tags.filter((tag) => typeof tag === 'string') : [];
  return {
    v: value,
    a: now,
    s: softTtlMs,
    h: hardTtlMs,
    e: expiresAt,
    r: staleAt,
    t: tags,
    n: 1,
  };
}

function readLocalEntry(key, now = Date.now()) {
  const entry = localCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.e != null && now >= entry.e) {
    localCache.delete(key);
    return null;
  }
  return entry;
}

function writeLocalEntry(key, envelope) {
  localCache.set(key, envelope);
}

function finalizeEnvelope(envelope, now = Date.now()) {
  if (!envelope) {
    return null;
  }
  const expiresAt = envelope.e != null ? envelope.e : null;
  if (expiresAt != null && now >= expiresAt) {
    return null;
  }
  const staleAt = envelope.r != null ? envelope.r : null;
  const stale = staleAt != null && now >= staleAt;
  const ageMs = now - envelope.a;
  return {
    value: envelope.v,
    stale,
    metadata: {
      storedAt: envelope.a,
      ageMs,
      softTtlMs: envelope.s,
      hardTtlMs: envelope.h,
      expiresAt,
      staleAt,
      tags: Array.isArray(envelope.t) ? [...envelope.t] : [],
    },
  };
}

async function getRedisClient() {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }
  if (redisClientPromise) {
    return redisClientPromise;
  }
  try {
    const client = createClient({ url: REDIS_URL });
    client.on('error', (err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[snapshot-cache] redis error: ${err.message}`);
      }
    });
    redisClientPromise = client
      .connect()
      .then(() => {
        redisClient = client;
        return redisClient;
      })
      .catch((err) => {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[snapshot-cache] unable to connect to redis: ${err.message}`);
        }
        redisClientPromise = null;
        redisClient = null;
        return null;
      });
    return redisClientPromise;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[snapshot-cache] redis client error: ${err.message}`);
    }
    return null;
  }
}

async function get(key, options = {}) {
  const normalizedKey = normalizeKey(key);
  const now = Date.now();
  const local = readLocalEntry(normalizedKey, now);
  if (local) {
    const finalized = finalizeEnvelope(local, now);
    if (finalized) {
      return finalized;
    }
    localCache.delete(normalizedKey);
  }

  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const raw = await redis.get(normalizedKey);
    if (!raw) {
      return null;
    }
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[snapshot-cache] failed to parse redis payload for ${normalizedKey}: ${err.message}`);
      }
      return null;
    }
    if (!envelope || typeof envelope !== 'object') {
      return null;
    }
    if (!Number.isFinite(envelope.a)) {
      envelope.a = now;
    }
    if (!Number.isFinite(envelope.s)) {
      envelope.s = toMs(options.softTtlMs, DEFAULT_MEMORY_SOFT_TTL_MS);
      envelope.r = envelope.a + envelope.s;
    }
    if (!Number.isFinite(envelope.h)) {
      envelope.h = toMs(options.hardTtlMs, DEFAULT_MEMORY_HARD_TTL_MS);
      envelope.e = envelope.a + envelope.h;
    }
    if (envelope.r == null && envelope.s != null) {
      envelope.r = envelope.a + envelope.s;
    }
    if (envelope.e == null && envelope.h != null) {
      envelope.e = envelope.a + envelope.h;
    }
    writeLocalEntry(normalizedKey, envelope);
    return finalizeEnvelope(envelope, now);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[snapshot-cache] redis get error for ${normalizedKey}: ${err.message}`);
    }
    return null;
  }
}

async function set(key, value, options = {}) {
  const normalizedKey = normalizeKey(key);
  const envelope = createEnvelope(value, options);
  writeLocalEntry(normalizedKey, envelope);

  const redis = await getRedisClient();
  if (!redis) {
    return;
  }

  try {
    const ttlSeconds = envelope.h ? Math.max(1, Math.ceil(envelope.h / 1000)) : undefined;
    const payload = JSON.stringify(envelope);
    if (ttlSeconds) {
      await redis.set(normalizedKey, payload, { EX: ttlSeconds });
    } else {
      await redis.set(normalizedKey, payload);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[snapshot-cache] redis set error for ${normalizedKey}: ${err.message}`);
    }
  }
}

async function invalidate(keys) {
  if (!keys) {
    return;
  }
  const list = Array.isArray(keys) ? keys : [keys];
  const normalized = [];
  for (const key of list) {
    try {
      normalized.push(normalizeKey(key));
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[snapshot-cache] invalid invalidate key ignored: ${err.message}`);
      }
    }
  }
  if (!normalized.length) {
    return;
  }
  for (const key of normalized) {
    localCache.delete(key);
  }
  const redis = await getRedisClient();
  if (!redis) {
    return;
  }
  try {
    await redis.del(normalized);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[snapshot-cache] redis delete error: ${err.message}`);
    }
  }
}

function clearLocal() {
  localCache.clear();
}

module.exports = {
  get,
  set,
  invalidate,
  getClient: getRedisClient,
  __private: {
    createEnvelope,
    finalizeEnvelope,
    writeLocalEntry,
    readLocalEntry,
    clearLocal,
    localCache,
  },
};
