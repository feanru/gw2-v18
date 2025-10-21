'use strict';

const { randomBytes } = require('crypto');
const path = require('path');
const { Worker } = require('worker_threads');
const snapshotCache = require('../utils/snapshotCache');
const {
  getPrecomputedAggregate,
  DEFAULT_SOFT_TTL_SECONDS: PRECOMPUTED_SOFT_TTL,
  DEFAULT_HARD_TTL_SECONDS: PRECOMPUTED_HARD_TTL,
} = require('../utils/precomputedAggregates');

const DEFAULT_LANG = (process.env.DEFAULT_LANG || 'es').trim() || 'es';
const FALLBACK_LANGS = Array.from(new Set(
  String(process.env.FALLBACK_LANGS ?? 'en')
    .split(',')
    .map((lang) => lang.trim().toLowerCase())
    .filter((lang) => lang && lang !== DEFAULT_LANG),
));
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const MONGO_READ_PREFERENCE = resolveMongoReadPreference(
  process.env.MONGO_READ_PREFERENCE,
);
const MAX_AGGREGATION_MS = Number(process.env.MAX_AGGREGATION_MS || 12000) || 12000;
const SOFT_TTL_SECONDS = normalizePositiveInt(
  process.env.AGGREGATE_SOFT_TTL || process.env.CACHE_TTL_FAST,
  600,
);
const DEFAULT_HARD_TTL = SOFT_TTL_SECONDS * 2;
const HARD_TTL_SECONDS = normalizePositiveInt(
  process.env.AGGREGATE_HARD_TTL || process.env.CACHE_TTL_SLOW,
  DEFAULT_HARD_TTL,
);
const CACHE_PREFIX = 'agg';
const CACHE_TTL_SECONDS = Math.max(HARD_TTL_SECONDS, SOFT_TTL_SECONDS);
const LOCK_PREFIX = 'agg:lock';
const LOCK_TTL_MS = MAX_AGGREGATION_MS + 1000;
const LOCK_WAIT_TIMEOUT_MS = MAX_AGGREGATION_MS * 2;
const LOCK_POLL_INTERVAL_MS = 150;

const PRECOMPUTED_SOFT_TTL_MS = (Number.isFinite(PRECOMPUTED_SOFT_TTL) ? PRECOMPUTED_SOFT_TTL : SOFT_TTL_SECONDS) * 1000;
const PRECOMPUTED_HARD_TTL_MS = (Number.isFinite(PRECOMPUTED_HARD_TTL) ? PRECOMPUTED_HARD_TTL : HARD_TTL_SECONDS) * 1000;

const WORKER_SCRIPT = path.resolve(__dirname, 'buildWorker.js');
const inFlightBuilds = new Map();

function normalizePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function cacheKey(itemId, lang) {
  return `${CACHE_PREFIX}:${lang}:${itemId}`;
}

function lockKey(itemId, lang) {
  return `${LOCK_PREFIX}:${lang}:${itemId}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOptionalPositiveInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }
  return Math.floor(num);
}

function getWorkerResourceLimits() {
  const limits = {};
  const maxOld = parseOptionalPositiveInt(process.env.AGGREGATE_MAX_OLD_MB);
  if (maxOld !== undefined) {
    limits.maxOldGenerationSizeMb = maxOld;
  }
  const maxYoung = parseOptionalPositiveInt(process.env.AGGREGATE_MAX_YOUNG_MB);
  if (maxYoung !== undefined) {
    limits.maxYoungGenerationSizeMb = maxYoung;
  }
  return Object.keys(limits).length > 0 ? limits : undefined;
}

function getWorkerExecArgv() {
  const preload = process.env.AGGREGATE_WORKER_PRELOAD;
  if (!preload) {
    return process.execArgv;
  }
  const resolved = path.resolve(preload);
  return [...process.execArgv, '-r', resolved];
}

function getWorkerExtraData() {
  const raw = process.env.AGGREGATE_WORKER_EXTRA_DATA;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[aggregate] failed to parse AGGREGATE_WORKER_EXTRA_DATA: ${err.message}`);
    }
    return null;
  }
}

function getWorkerSharedBuffer() {
  if (typeof SharedArrayBuffer === 'undefined') {
    return null;
  }
  const shared = globalThis && globalThis.__AGGREGATE_WORKER_SHARED__;
  return shared instanceof SharedArrayBuffer ? shared : null;
}

function createWorkerData(itemId, lang) {
  const workerData = {
    itemId,
    lang,
    config: {
      defaultLang: DEFAULT_LANG,
      maxAggregationMs: MAX_AGGREGATION_MS,
      softTtlSeconds: SOFT_TTL_SECONDS,
      mongo: {
        url: MONGO_URL,
        readPreference: MONGO_READ_PREFERENCE,
        maxPoolSize: 8,
      },
    },
  };
  const extra = getWorkerExtraData();
  if (extra !== null) {
    workerData.extra = extra;
  }
  const shared = getWorkerSharedBuffer();
  if (shared) {
    workerData.shared = shared;
  }
  return workerData;
}

function resolveMongoReadPreference(value) {
  if (typeof value !== 'string') {
    return 'secondaryPreferred';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 'secondaryPreferred';
  }
  return trimmed;
}

async function getRedisClient() {
  return snapshotCache.getClient();
}

async function readSnapshotEntry(itemId, lang) {
  const key = cacheKey(itemId, lang);
  const cached = await snapshotCache.get(key, {
    softTtlSeconds: SOFT_TTL_SECONDS,
    hardTtlSeconds: CACHE_TTL_SECONDS,
  });
  if (!cached || !cached.value) {
    return null;
  }
  const payload = cached.value;
  if (payload?.meta && Object.prototype.hasOwnProperty.call(payload.meta, 'precomputed')) {
    payload.meta.precomputed = Boolean(payload.meta.precomputed);
  }
  return {
    payload,
    stale: Boolean(cached.stale),
    metadata: cached.metadata || null,
  };
}

async function readSnapshot(itemId, lang) {
  const entry = await readSnapshotEntry(itemId, lang);
  return entry ? entry.payload : null;
}

function markMetaPrecomputed(meta) {
  if (!meta || typeof meta !== 'object') {
    return { precomputed: true };
  }
  if (meta.precomputed !== true) {
    meta.precomputed = Boolean(meta.precomputed);
    if (!meta.precomputed) {
      meta.precomputed = true;
    }
  }
  return meta;
}

async function reuseFreshPrecomputedSnapshot(itemId, lang) {
  const cachedEntry = await readSnapshotEntry(itemId, lang);
  if (cachedEntry?.payload?.meta?.precomputed) {
    const meta = cachedEntry.payload.meta;
    const stale = Boolean(cachedEntry.stale) || isExpired(meta);
    meta.stale = Boolean(meta.stale) || stale;
    meta.precomputed = true;
    if (!stale) {
      return cachedEntry.payload;
    }
  }

  try {
    const mongoEntry = await getPrecomputedAggregate({ itemId, lang });
    if (mongoEntry?.payload && mongoEntry.expired !== true) {
      const payload = mongoEntry.payload;
      const meta = markMetaPrecomputed(payload.meta);
      payload.meta = meta;
      const stale = Boolean(mongoEntry.stale) || isExpired(meta);
      meta.stale = Boolean(meta.stale) || stale;
      if (!stale) {
        try {
          await snapshotCache.set(cacheKey(itemId, lang), payload, {
            softTtlMs: PRECOMPUTED_SOFT_TTL_MS,
            hardTtlMs: PRECOMPUTED_HARD_TTL_MS,
            tags: [`item:${itemId}`, `lang:${lang}`, 'precomputed'],
          });
        } catch (cacheErr) {
          if (process.env.NODE_ENV !== 'test') {
            console.warn(
              `[aggregate] failed to propagate precomputed snapshot for ${itemId}/${lang}: ${cacheErr.message}`,
            );
          }
        }
        return payload;
      }
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[aggregate] unable to read precomputed snapshot for ${itemId}/${lang}: ${err.message}`,
      );
    }
  }

  return null;
}

async function writeSnapshot(itemId, lang, payload) {
  const key = cacheKey(itemId, lang);
  await snapshotCache.set(key, payload, {
    softTtlSeconds: SOFT_TTL_SECONDS,
    hardTtlSeconds: CACHE_TTL_SECONDS,
    tags: [`item:${itemId}`, `lang:${lang}`],
  });
}

async function tryAcquireRedisLock(redis, key, token, ttlMs) {
  const acquired = await redis.setNX(key, token);
  if (!acquired) {
    return false;
  }
  const expireResult = await redis.pExpire(key, ttlMs);
  if (!expireResult) {
    try {
      await redis.del(key);
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[aggregate] failed to clean redis lock ${key}: ${err.message}`);
      }
    }
    return false;
  }
  return true;
}

async function releaseRedisLock(redis, key, token) {
  const script = `if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end`;
  await redis.eval(script, {
    keys: [key],
    arguments: [token],
  });
}

async function acquireLockOrReuseSnapshot(redis, itemId, lang) {
  const key = lockKey(itemId, lang);
  const token = randomBytes(16).toString('hex');

  try {
    const gotLock = await tryAcquireRedisLock(redis, key, token, LOCK_TTL_MS);
    if (gotLock) {
      return { token };
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[aggregate] redis lock acquire failed for ${key}: ${err.message}`);
    }
    return { token: null };
  }

  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(LOCK_POLL_INTERVAL_MS);
    let exists = 0;
    try {
      exists = await redis.exists(key);
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[aggregate] redis exists failed for ${key}: ${err.message}`);
      }
      break;
    }

    if (!exists) {
      const cached = await readSnapshotEntry(itemId, lang);
      if (cached?.payload) {
        return { payload: cached.payload };
      }
      try {
        const acquired = await tryAcquireRedisLock(redis, key, token, LOCK_TTL_MS);
        if (acquired) {
          return { token };
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[aggregate] redis lock retry failed for ${key}: ${err.message}`);
        }
        break;
      }
    }
  }

  return { token: null };
}

function isExpired(meta, now = Date.now()) {
  if (!meta) {
    return false;
  }
  const expiresAt = meta.expiresAt;
  if (!expiresAt) {
    return false;
  }
  const ts = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return now >= ts;
}

function normalizeSnapshotTimestamp(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return typeof value === 'string' ? value : null;
  }
  return parsed.toISOString();
}

async function executeBuild(itemId, lang) {
  const normalizedLang = (lang || DEFAULT_LANG).trim() || DEFAULT_LANG;
  const normalizedId = Number(itemId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error('Invalid itemId');
  }

  const workerData = createWorkerData(normalizedId, normalizedLang);
  const workerOptions = {
    workerData,
    execArgv: getWorkerExecArgv(),
  };
  const resourceLimits = getWorkerResourceLimits();
  if (resourceLimits) {
    workerOptions.resourceLimits = resourceLimits;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    const worker = new Worker(WORKER_SCRIPT, workerOptions);

    const finalize = (fn) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      try {
        fn();
      } finally {
        if (worker) {
          worker.removeAllListeners?.();
        }
      }
    };

    worker.once('message', (message) => {
      finalize(() => {
        if (message && message.ok) {
          resolve(message.payload);
        } else {
          const err = new Error(message?.error?.message || 'Worker build failed');
          if (message?.error?.code) {
            err.code = message.error.code;
          }
          reject(err);
        }
        worker.terminate().catch(() => {});
      });
    });

    worker.once('error', (err) => {
      finalize(() => {
        reject(err);
      });
    });

    worker.once('exit', (code) => {
      finalize(() => {
        if (code === 0) {
          const err = new Error('Worker exited before sending result');
          err.code = 'AGGREGATION_WORKER_EXIT';
          reject(err);
        } else {
          const err = new Error(`Worker exited with code ${code}`);
          err.code = 'AGGREGATION_WORKER_EXIT';
          reject(err);
        }
      });
    });

    timeoutId = setTimeout(() => {
      finalize(() => {
        const err = new Error('Aggregation timeout exceeded');
        err.code = 'AGGREGATION_TIMEOUT';
        worker.terminate().catch(() => {});
        reject(err);
      });
    }, MAX_AGGREGATION_MS);
    if (typeof timeoutId.unref === 'function') {
      timeoutId.unref();
    }
  });
}

function ensureBuild(itemId, lang, options = {}) {
  const normalizedLang = (lang || DEFAULT_LANG).trim() || DEFAULT_LANG;
  const normalizedId = Number(itemId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    return Promise.reject(new Error('Invalid itemId'));
  }
  const key = cacheKey(normalizedId, normalizedLang);
  if (inFlightBuilds.has(key)) {
    return inFlightBuilds.get(key);
  }
  const promise = (async () => {
    const forceRebuild = Boolean(options && options.forceRebuild);
    if (!forceRebuild) {
      const precomputed = await reuseFreshPrecomputedSnapshot(normalizedId, normalizedLang);
      if (precomputed) {
        return precomputed;
      }
    }
    const redis = await getRedisClient();
    let lockToken = null;
    if (redis) {
      try {
        const { token, payload } = await acquireLockOrReuseSnapshot(redis, normalizedId, normalizedLang);
        if (payload) {
          return payload;
        }
        lockToken = token ?? null;
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(
            `[aggregate] unexpected redis lock error for ${normalizedId}/${normalizedLang}: ${err.message}`,
          );
        }
        lockToken = null;
      }
    }

    try {
      const payload = await executeBuild(normalizedId, normalizedLang);
      try {
        await writeSnapshot(normalizedId, normalizedLang, payload);
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[aggregate] cache write failed for ${key}: ${err.message}`);
        }
      }
      return payload;
    } finally {
      if (lockToken && redis && redis.isOpen) {
        try {
          await releaseRedisLock(redis, lockKey(normalizedId, normalizedLang), lockToken);
        } catch (err) {
          if (process.env.NODE_ENV !== 'test') {
            console.warn(
              `[aggregate] failed to release redis lock for ${normalizedId}/${normalizedLang}: ${err.message}`,
            );
          }
        }
      }
    }
  })()
    .finally(() => {
      inFlightBuilds.delete(key);
    });
  inFlightBuilds.set(key, promise);
  return promise;
}

async function getCachedAggregate(itemId, lang) {
  const normalizedLang = (lang || DEFAULT_LANG).trim() || DEFAULT_LANG;
  const normalizedId = Number(itemId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    return null;
  }
  const key = cacheKey(normalizedId, normalizedLang);
  const cacheEntry = await readSnapshotEntry(normalizedId, normalizedLang);
  const payload = cacheEntry ? cacheEntry.payload : null;
  if (!payload) {
    return null;
  }
  const baseMeta = payload.meta || {};
  const meta = { ...baseMeta };
  const hasSnapshot = Object.prototype.hasOwnProperty.call(baseMeta, 'snapshotAt');
  let snapshotAt = normalizeSnapshotTimestamp(hasSnapshot ? baseMeta.snapshotAt : baseMeta.generatedAt);
  if (snapshotAt === undefined) {
    snapshotAt = null;
  }
  meta.snapshotAt = snapshotAt;
  const staleFromCache = cacheEntry ? Boolean(cacheEntry.stale) : false;
  meta.stale = Boolean(meta.stale) || staleFromCache || isExpired(meta);
  if (Object.prototype.hasOwnProperty.call(payload.meta || {}, 'precomputed')) {
    meta.precomputed = Boolean(payload.meta.precomputed);
  }
  meta.warnings = Array.isArray(payload.meta?.warnings)
    ? [...payload.meta.warnings]
    : [];
  meta.errors = Array.isArray(payload.meta?.errors) ? [...payload.meta.errors] : [];
  const cacheMetadata = cacheEntry?.metadata
    ? { ...cacheEntry.metadata, stale: staleFromCache }
    : { stale: staleFromCache };
  return {
    data: payload.data,
    meta,
    cache: cacheMetadata,
  };
}

function scheduleAggregateBuild(itemId, lang) {
  return ensureBuild(itemId, lang).catch((err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[aggregate] build failed for ${itemId}/${lang}: ${err.message}`);
    }
    throw err;
  });
}

module.exports = {
  buildItemAggregate: ensureBuild,
  getCachedAggregate,
  scheduleAggregateBuild,
  isAggregateExpired: isExpired,
  DEFAULT_LANG,
  FALLBACK_LANGS,
  MAX_AGGREGATION_MS,
  SOFT_TTL_SECONDS,
  HARD_TTL_SECONDS,
};
