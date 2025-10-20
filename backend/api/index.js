'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const snapshotCache = require('../utils/snapshotCache');
const aggregateModule = require('../aggregates/buildItemAggregate');
const aggregateHelpers = require('./aggregate');
const { createLegacyRouter } = require('./legacy');
const legacyHandlersModule = require('./legacy/handlers');
const { createLegacyHandlers } = legacyHandlersModule;
const { parseNumericParamList } = legacyHandlersModule.__private;

const { DEFAULT_LANG, FALLBACK_LANGS } = aggregateModule;
let buildItemAggregateFn = aggregateModule.buildItemAggregate;
let getCachedAggregateFn = aggregateModule.getCachedAggregate;
let scheduleAggregateBuildFn = aggregateModule.scheduleAggregateBuild;
let isAggregateExpiredFn = aggregateModule.isAggregateExpired;

const ADMIN_TOKEN = (process.env.ADMIN_DASHBOARD_TOKEN || '').trim() || null;
const DASHBOARD_WINDOW_MINUTES = Number.parseInt(
  process.env.ADMIN_DASHBOARD_WINDOW_MINUTES || '15',
  10,
);
const DASHBOARD_WINDOW_MS = Number.isFinite(DASHBOARD_WINDOW_MINUTES) && DASHBOARD_WINDOW_MINUTES > 0
  ? DASHBOARD_WINDOW_MINUTES * 60 * 1000
  : 15 * 60 * 1000;
const METRICS_COLLECTION = 'apiMetrics';
const SYNC_STATUS_COLLECTION = 'syncStatus';
const MONITORED_COLLECTIONS = ['items', 'prices', 'recipes'];
const JS_ERROR_COLLECTION = 'jsErrors';
const JS_ERROR_STATS_COLLECTION = 'jsErrorStats';
const JS_ERROR_REDIS_KEY = 'telemetry:jsErrors';

const JS_ERROR_BODY_LIMIT_BYTES = Math.max(
  Number.parseInt(process.env.ADMIN_JS_ERROR_MAX_BYTES || '16384', 10) || 0,
  1024,
);
const RAW_JS_ERROR_WINDOW_MINUTES = Number.parseFloat(
  process.env.ADMIN_JS_ERROR_WINDOW_MINUTES || `${DASHBOARD_WINDOW_MINUTES}`,
);
const JS_ERROR_WINDOW_MINUTES =
  Number.isFinite(RAW_JS_ERROR_WINDOW_MINUTES) && RAW_JS_ERROR_WINDOW_MINUTES > 0
    ? RAW_JS_ERROR_WINDOW_MINUTES
    : DASHBOARD_WINDOW_MS / 60000;
const JS_ERROR_WINDOW_MS = Math.max(JS_ERROR_WINDOW_MINUTES * 60 * 1000, 60000);
const JS_ERROR_ALERT_THRESHOLD_PER_MINUTE = Number.isFinite(
  Number.parseFloat(process.env.ADMIN_JS_ERROR_ALERT_THRESHOLD_PER_MINUTE || '5'),
)
  ? Number.parseFloat(process.env.ADMIN_JS_ERROR_ALERT_THRESHOLD_PER_MINUTE || '5')
  : 5;
const FRESHNESS_ALERT_THRESHOLD_MINUTES = Number.isFinite(
  Number.parseFloat(process.env.ADMIN_FRESHNESS_ALERT_THRESHOLD_MINUTES || '60'),
)
  ? Number.parseFloat(process.env.ADMIN_FRESHNESS_ALERT_THRESHOLD_MINUTES || '60')
  : 60;
const ALERT_WEBHOOK_URL = (process.env.ADMIN_ALERT_WEBHOOK_URL || '').trim() || null;
const ALERT_WEBHOOK_COOLDOWN_MS = Math.max(
  Number.parseInt(process.env.ADMIN_ALERT_WEBHOOK_COOLDOWN_MS || '300000', 10) || 0,
  0,
);
const JS_ERROR_MAX_MESSAGE_LENGTH = 512;
const JS_ERROR_MAX_STACK_LENGTH = 4000;
const JS_ERROR_MAX_URL_LENGTH = 1024;
const JS_ERROR_MAX_META_ENTRIES = 10;

const API_HOST = process.env.API_HOST || '0.0.0.0';
const API_PORT = Number(process.env.API_PORT || 3300);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL_FAST_SECONDS = Math.max(
  Number.parseInt(process.env.CACHE_TTL_FAST || process.env.CACHE_TTL_FAST_SECONDS || '120', 10) || 0,
  0,
);
const DASHBOARD_CACHE_SOFT_MS = Math.max(Number(process.env.DASHBOARD_CACHE_MS || 60000) || 0, 5000);
const DASHBOARD_CACHE_HARD_MS = Math.max(
  Number(process.env.DASHBOARD_CACHE_STALE_MS || 0) || DASHBOARD_CACHE_SOFT_MS * 5,
  DASHBOARD_CACHE_SOFT_MS + 1000,
);
const DASHBOARD_CACHE_KEY = 'snapshot:dashboard';

const GW2_ITEM_ENDPOINT = 'https://api.guildwars2.com/v2/items';
const ITEM_FALLBACK_TIMEOUT_MS = Math.max(
  Number.parseInt(process.env.ITEM_FALLBACK_TIMEOUT_MS || '8000', 10) || 0,
  0,
);

const DEFAULT_MARKET_CSV_FIELDS = [
  'id',
  'buy_price',
  'sell_price',
  'buy_quantity',
  'sell_quantity',
  'last_updated',
  '1d_buy_sold',
  '1d_sell_sold',
  '2d_buy_sold',
  '2d_sell_sold',
  '7d_buy_sold',
  '7d_sell_sold',
  '1m_buy_sold',
  '1m_sell_sold',
];

const RESPONSE_CONTEXT_KEY = '__responseContext';

let mongoClientPromise = null;
let redisClientPromise = null;
let redisClient = null;
const alertNotificationState = new Map();
let dashboardRefreshPromise = null;

function normalizeLang(lang) {
  if (!lang) {
    return DEFAULT_LANG;
  }
  const normalized = String(lang).trim().toLowerCase();
  return normalized || DEFAULT_LANG;
}

function buildCandidateLangs(lang) {
  const normalized = normalizeLang(lang);
  const list = [];
  const seen = new Set();
  function add(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    if (!normalizedValue || seen.has(normalizedValue)) return;
    seen.add(normalizedValue);
    list.push(normalizedValue);
  }
  add(normalized);
  if (normalized !== DEFAULT_LANG) add(DEFAULT_LANG);
  if (Array.isArray(FALLBACK_LANGS)) {
    FALLBACK_LANGS.forEach(add);
  }
  return list;
}

function getRedisKeyForLang(lang) {
  const normalized = normalizeLang(lang);
  return normalized === DEFAULT_LANG ? 'items' : `items:${normalized}`;
}

function generateTraceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function getResponseContext(res) {
  if (!res || typeof res !== 'object') {
    return {};
  }
  return res[RESPONSE_CONTEXT_KEY] || {};
}

function normalizeErrors(errors) {
  if (!errors) {
    return [];
  }
  const list = Array.isArray(errors) ? errors : [errors];
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    if (entry == null) {
      continue;
    }
    const value = String(entry);
    if (!value) {
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeErrorObjects(errors) {
  if (!errors) {
    return [];
  }
  const list = Array.isArray(errors) ? errors.flat(Infinity) : [errors];
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    if (entry == null) {
      continue;
    }
    let code = null;
    let msg = null;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      code = trimmed;
      msg = trimmed;
    } else if (typeof entry === 'object') {
      const normalizedCode = entry.code ?? entry.error ?? null;
      const normalizedMsg = entry.msg ?? entry.message ?? null;
      if (normalizedCode != null) {
        const candidate = String(normalizedCode).trim();
        if (candidate) {
          code = candidate;
        }
      }
      if (normalizedMsg != null) {
        const candidate = String(normalizedMsg).trim();
        if (candidate) {
          msg = candidate;
        }
      }
      if (!code && !msg) {
        continue;
      }
      if (!code && msg) {
        code = msg;
      } else if (code && !msg) {
        msg = code;
      }
    } else {
      const value = String(entry).trim();
      if (!value) {
        continue;
      }
      code = value;
      msg = value;
    }

    if (!code) {
      code = 'errorUnknown';
    }
    if (!msg) {
      msg = code;
    }

    const key = code;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ code, msg });
  }
  return result;
}

function combineErrors(...sources) {
  const collected = [];
  for (const source of sources) {
    if (!source) {
      continue;
    }
    if (Array.isArray(source)) {
      collected.push(...source);
    } else {
      collected.push(source);
    }
  }
  return collected.filter((entry) => entry != null);
}

function extractMetaAndErrors(metaOverrides = {}) {
  if (!metaOverrides || typeof metaOverrides !== 'object') {
    return { meta: {}, errors: [] };
  }
  const { errors, traceId: _traceId, ts: _ts, ...rest } = metaOverrides;
  let collectedErrors = [];
  if (errors != null) {
    const list = Array.isArray(errors) ? errors.flat(Infinity) : [errors];
    collectedErrors = list.filter((entry) => entry != null);
  }
  return { meta: rest, errors: collectedErrors };
}

function toIsoString(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveSnapshotId(meta) {
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const candidates = [meta.snapshotAt, meta.generatedAt, meta.lastUpdated];
  for (const candidate of candidates) {
    const iso = toIsoString(candidate);
    if (iso) {
      return iso;
    }
  }
  return null;
}

function computeSnapshotTtlMs(meta, cacheMetadata, { stale = false } = {}) {
  if (stale || cacheMetadata?.stale) {
    return 0;
  }
  const now = Date.now();
  if (cacheMetadata && Number.isFinite(cacheMetadata.staleAt)) {
    return Math.max(0, cacheMetadata.staleAt - now);
  }
  if (
    cacheMetadata &&
    Number.isFinite(cacheMetadata.softTtlMs) &&
    Number.isFinite(cacheMetadata.storedAt)
  ) {
    return Math.max(0, cacheMetadata.storedAt + cacheMetadata.softTtlMs - now);
  }
  const expiresCandidate = meta?.expiresAt;
  if (expiresCandidate != null) {
    const expiresAt =
      expiresCandidate instanceof Date ? expiresCandidate.getTime() : Date.parse(expiresCandidate);
    if (Number.isFinite(expiresAt)) {
      return Math.max(0, expiresAt - now);
    }
  }
  return null;
}

function computeConditionalHeaders(meta, itemId, lang, options = {}) {
  const headers = {};
  let snapshotIso = null;
  if (meta && typeof meta === 'object') {
    snapshotIso = toIsoString(meta.snapshotAt);
    if (snapshotIso) {
      const normalizedLang = normalizeLang(meta.lang ?? lang ?? DEFAULT_LANG);
      const hash = crypto.createHash('sha256');
      hash.update(`${snapshotIso}|${String(itemId ?? '')}|${normalizedLang}`);
      const etag = `"${hash.digest('hex')}"`;
      headers.ETag = etag;
      const snapshotDate = new Date(snapshotIso);
      if (!Number.isNaN(snapshotDate.getTime())) {
        headers['Last-Modified'] = snapshotDate.toUTCString();
      }
    }

    const snapshotId = options.snapshotId || resolveSnapshotId(meta);
    if (snapshotId) {
      headers['X-Snapshot-Id'] = snapshotId;
    }

    const ttlMs = computeSnapshotTtlMs(meta, options.cache, { stale: options.stale });
    if (ttlMs != null) {
      const ttlSeconds = Math.max(0, Math.floor(ttlMs / 1000));
      headers['X-Snapshot-TTL'] = String(ttlSeconds);
      return { headers, snapshotIso, snapshotId, ttlMs };
    }
    return { headers, snapshotIso, snapshotId, ttlMs: null };
  }

  return { headers, snapshotIso: null, snapshotId: null, ttlMs: null };
}

function shouldSendNotModified(req, headers, snapshotIso, options = {}) {
  const { stale = false, hasData = false } = options;
  if (!req || !headers || !headers.ETag || !snapshotIso || stale || !hasData) {
    return false;
  }
  const requestHeaders = req.headers || {};
  const ifNoneMatch = requestHeaders['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.trim()) {
    const tagList = ifNoneMatch
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value);
    if (tagList.includes('*') || tagList.includes(headers.ETag)) {
      return true;
    }
  }

  const lastModified = headers['Last-Modified'];
  const ifModifiedSince = requestHeaders['if-modified-since'];
  if (lastModified && typeof ifModifiedSince === 'string' && ifModifiedSince.trim()) {
    const sinceDate = new Date(ifModifiedSince);
    const snapshotDate = new Date(snapshotIso);
    if (!Number.isNaN(sinceDate.getTime()) && !Number.isNaN(snapshotDate.getTime())) {
      if (snapshotDate.getTime() <= sinceDate.getTime()) {
        return true;
      }
    }
  }

  return false;
}

function writeNotModified(res, headers = {}) {
  const finalHeaders = {
    ...headers,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
  trackResponseMetrics(res, 0);
  res.writeHead(304, finalHeaders);
  res.end();
}

function readRequestBody(req, { maxBytes = 16384 } = {}) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      resolve('');
      return;
    }
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 16384;
    const chunks = [];
    let total = 0;
    let resolved = false;

    const cleanup = () => {
      req.off?.('data', onData);
      req.off?.('end', onEnd);
      req.off?.('error', onError);
    };

    const finalize = (err, body) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      if (err) {
        reject(err);
      } else {
        resolve(body);
      }
    };

    const onData = (chunk) => {
      if (!chunk || resolved) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) {
        finalize(new Error('PayloadTooLarge'));
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (resolved) {
        return;
      }
      const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
      finalize(null, body);
    };

    const onError = (err) => {
      finalize(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

async function parseJsonBody(req, options = {}) {
  const raw = await readRequestBody(req, options);
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const error = new Error('InvalidJson');
    error.cause = err;
    throw error;
  }
}

function buildMeta(metaOverrides = {}, context = {}) {
  const meta = { ...metaOverrides };
  const normalizedLang = normalizeLang(metaOverrides.lang ?? DEFAULT_LANG);
  const contextTs = context.ts && toIsoString(context.ts);
  const hasExplicitLastUpdated = Object.prototype.hasOwnProperty.call(
    metaOverrides,
    'lastUpdated',
  );
  let lastUpdated = null;
  if (hasExplicitLastUpdated) {
    if (metaOverrides.lastUpdated === null) {
      lastUpdated = null;
    } else {
      const normalized = toIsoString(metaOverrides.lastUpdated);
      lastUpdated = normalized != null ? normalized : null;
    }
  } else {
    lastUpdated =
      (context.lastUpdated ? toIsoString(context.lastUpdated) : null) ||
      contextTs ||
      new Date().toISOString();
  }

  meta.lang = normalizedLang;
  meta.lastUpdated = lastUpdated;
  meta.stale = Boolean(metaOverrides.stale);
  meta.traceId = context.traceId || generateTraceId();
  meta.ts = contextTs || new Date().toISOString();

  return meta;
}

function trackResponseMetrics(res, byteLength = 0) {
  const context = getResponseContext(res);
  if (!context || typeof context !== 'object') {
    return;
  }
  if (!context.__responseMetrics) {
    context.__responseMetrics = {
      firstByteAt: null,
      responseSizeBytes: 0,
    };
  }
  const metrics = context.__responseMetrics;
  if (metrics.firstByteAt == null) {
    try {
      metrics.firstByteAt = process.hrtime.bigint();
    } catch (err) {
      metrics.firstByteAt = null;
    }
  }
  if (Number.isFinite(byteLength) && byteLength > 0) {
    metrics.responseSizeBytes = (metrics.responseSizeBytes || 0) + byteLength;
  } else if (!Number.isFinite(metrics.responseSizeBytes)) {
    metrics.responseSizeBytes = 0;
  }
}

function writeResponse(
  res,
  statusCode,
  data,
  metaOverrides = {},
  errors = [],
  additionalHeaders = {},
) {
  const context = getResponseContext(res);
  const meta = buildMeta(metaOverrides, context);
  let normalizedErrors = [];
  if (errors && (Array.isArray(errors) ? errors.length : true)) {
    const list = Array.isArray(errors) ? errors : [errors];
    const hasObjectEntries = list.some(
      (entry) => entry && typeof entry === 'object' && !Array.isArray(entry),
    );
    normalizedErrors = hasObjectEntries ? normalizeErrorObjects(list) : normalizeErrors(list);
  }
  const payload = { data, meta };
  if (normalizedErrors.length > 0) {
    payload.errors = normalizedErrors;
  }
  const body = JSON.stringify(payload);
  const bodyLength = Buffer.byteLength(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...additionalHeaders,
  };
  headers['Content-Length'] = bodyLength;
  trackResponseMetrics(res, bodyLength);
  res.writeHead(statusCode, headers);
  res.end(body);
}

function ok(res, data, metaOverrides = {}, options = {}) {
  const { meta, errors } = extractMetaAndErrors(metaOverrides);
  const statusCode = options.statusCode ?? 200;
  const combined = combineErrors(errors, options.errors || []);
  writeResponse(res, statusCode, data, meta, combined, options.headers || {});
}

function fail(res, statusCode, code, msg, metaOverrides = {}, ...additionalErrors) {
  const { meta, errors: metaErrors } = extractMetaAndErrors(metaOverrides);
  const extras = additionalErrors.flat ? additionalErrors.flat(Infinity) : additionalErrors;
  const allErrors = normalizeErrorObjects([
    { code, msg },
    ...(metaErrors || []),
    ...(extras || []),
  ]);
  writeResponse(res, statusCode, null, meta, allErrors);
}

function createLegacyLogger(override) {
  if (override && typeof override === 'object') {
    return override;
  }
  return {
    warn: (...args) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(...args);
      }
    },
    error: (...args) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error(...args);
      }
    },
  };
}

function createLegacyRouterDeps(overrides = {}) {
  const configOverride = overrides.config || {};
  const deps = {
    ok,
    fail,
    normalizeLang,
    config: {
      defaultLang: DEFAULT_LANG,
      ...(configOverride || {}),
    },
    logger: createLegacyLogger(overrides.logger),
  };
  if (overrides.fetchImpl) {
    deps.fetchImpl = overrides.fetchImpl;
  }
  if (overrides.invalidateCache) {
    deps.invalidateCache = overrides.invalidateCache;
  }
  return deps;
}

function createLegacyRouterInstance(overrides = {}) {
  return createLegacyRouter(createLegacyRouterDeps(overrides));
}

function createLegacyBundleHandlerInstance(overrides = {}) {
  const configOverride = overrides.config || {};
  const featureFlagsOverride = {
    ...(configOverride.featureFlags || {}),
    forceLocalOnly: true,
  };
  const mergedOverrides = {
    ...overrides,
    config: {
      ...configOverride,
      featureFlags: featureFlagsOverride,
    },
  };
  const handlers = createLegacyHandlers(createLegacyRouterDeps(mergedOverrides));
  return handlers.handleDataBundle;
}

let legacyRouter = createLegacyRouterInstance();
let legacyBundleHandler = createLegacyBundleHandlerInstance();

function setLegacyOverrides(overrides = {}) {
  legacyRouter = createLegacyRouterInstance(overrides);
  legacyBundleHandler = createLegacyBundleHandlerInstance(overrides);
}

function resetLegacyOverrides() {
  legacyRouter = createLegacyRouterInstance();
  legacyBundleHandler = createLegacyBundleHandlerInstance();
}

async function getMongoClient() {
  if (mongoClientPromise) {
    return mongoClientPromise;
  }
  const client = new MongoClient(MONGO_URL, { maxPoolSize: 8 });
  mongoClientPromise = client
    .connect()
    .then(() => client)
    .catch((err) => {
      mongoClientPromise = null;
      throw err;
    });
  return mongoClientPromise;
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
        console.warn(`[api] redis error: ${err.message}`);
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
          console.warn(`[api] unable to connect to redis: ${err.message}`);
        }
        redisClientPromise = null;
        redisClient = null;
        return null;
      });
    return redisClientPromise;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[api] redis client error: ${err.message}`);
    }
    return null;
  }
}

function sanitizeItemDocument(doc) {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  const { _id, lastUpdated, ...rest } = doc;
  if (lastUpdated instanceof Date) {
    rest.lastUpdated = lastUpdated.toISOString();
  } else if (typeof lastUpdated === 'string') {
    rest.lastUpdated = lastUpdated;
  }
  return rest;
}

function cloneAndFilterDocument(doc, keysToRemove = []) {
  if (!doc || typeof doc !== 'object') {
    return null;
  }

  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(doc));
  } catch (err) {
    cloned = { ...doc };
    if (Array.isArray(doc.ingredients)) {
      cloned.ingredients = doc.ingredients.map((ingredient) => ({ ...ingredient }));
    }
  }

  const removals = new Set(['_id', ...keysToRemove]);
  for (const key of removals) {
    if (Object.prototype.hasOwnProperty.call(cloned, key)) {
      delete cloned[key];
    }
  }

  return cloned;
}

function sanitizeRecipeDocument(doc) {
  return cloneAndFilterDocument(doc, ['lang', 'source']);
}

function sanitizeMarketDocument(doc) {
  const sanitized = cloneAndFilterDocument(doc, ['lang', 'source']);
  if (!sanitized) {
    return {};
  }
  return sanitized;
}

function parseMarketCsvFieldList(searchParams) {
  if (!searchParams) {
    return [];
  }
  const fields = [];
  const seen = new Set();

  const addField = (field) => {
    if (field == null) {
      return;
    }
    const normalized = String(field).trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    fields.push(normalized);
  };

  for (const [key, value] of searchParams.entries()) {
    if (key === 'fields' || key === 'fields[]' || key.startsWith('fields[')) {
      if (Array.isArray(value)) {
        value.forEach(addField);
        continue;
      }
      const raw = value == null ? '' : String(value);
      if (!raw) {
        continue;
      }
      raw
        .split(',')
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk !== '')
        .forEach(addField);
    }
  }

  return fields;
}

function resolveMarketFieldValue(doc, field) {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(doc, field)) {
    return doc[field];
  }
  if (field === 'last_updated') {
    if (Object.prototype.hasOwnProperty.call(doc, 'last_updated')) {
      return doc.last_updated;
    }
    if (Object.prototype.hasOwnProperty.call(doc, 'lastUpdated')) {
      return doc.lastUpdated;
    }
  }
  if (field === 'lastUpdated' && Object.prototype.hasOwnProperty.call(doc, 'last_updated')) {
    return doc.last_updated;
  }
  if (field === 'last_modified') {
    if (Object.prototype.hasOwnProperty.call(doc, 'last_modified')) {
      return doc.last_modified;
    }
    if (Object.prototype.hasOwnProperty.call(doc, 'lastModified')) {
      return doc.lastModified;
    }
  }
  if (field === 'lastModified' && Object.prototype.hasOwnProperty.call(doc, 'last_modified')) {
    return doc.last_modified;
  }
  return null;
}

function formatCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  const str = String(value);
  if (str === '') {
    return '';
  }
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toDate(value) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }
  const str = String(value).trim();
  if (!str) {
    return null;
  }
  const parsed = Date.parse(str);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function getLatestLastModified(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return null;
  }
  let latest = null;
  for (const doc of documents) {
    if (!doc || typeof doc !== 'object') {
      continue;
    }
    const candidates = [
      doc.lastModified,
      doc.last_modified,
      doc.lastUpdated,
      doc.last_updated,
      doc.updatedAt,
      doc.updated_at,
    ];
    for (const candidate of candidates) {
      const date = toDate(candidate);
      if (!date) {
        continue;
      }
      if (!latest || date > latest) {
        latest = date;
      }
    }
  }
  return latest;
}

function shouldReturnNotModified(headers, etag, lastModifiedDate) {
  const normalizedHeaders = headers || {};
  const ifNoneMatch = normalizedHeaders['if-none-match'];
  if (ifNoneMatch && etag) {
    const etagList = String(ifNoneMatch)
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (etagList.includes('*') || etagList.includes(etag)) {
      return true;
    }
  }

  const ifModifiedSince = normalizedHeaders['if-modified-since'];
  if (ifModifiedSince && lastModifiedDate instanceof Date) {
    const parsed = toDate(ifModifiedSince);
    if (parsed && lastModifiedDate <= parsed) {
      return true;
    }
  }

  return false;
}

async function handleMarketCsvRequest(req, res, url) {
  const ids = parseNumericParamList(url.searchParams, 'ids');
  if (ids.length === 0) {
    fail(res, 400, 'ids_required', 'ids required', {
      lang: DEFAULT_LANG,
      source: 'marketCsv',
      stale: false,
    });
    return;
  }

  let documents = [];
  try {
    const client = await getMongoClient();
    if (!client || typeof client.db !== 'function') {
      throw new Error('mongo client unavailable');
    }
    const collection = client.db().collection('prices');
    const cursor = collection.find({ id: { $in: ids } }, { projection: { _id: 0 } });
    documents = await cursor.toArray();
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[api] failed to read market prices: ${err.message}`);
    }
    fail(res, 503, 'market_unavailable', 'Market data unavailable', {
      lang: DEFAULT_LANG,
      source: 'marketCsv',
      stale: true,
    });
    return;
  }

  const sanitizedDocs = Array.isArray(documents)
    ? documents.map((doc) => sanitizeMarketDocument(doc))
    : [];
  const docMap = new Map();
  for (const doc of sanitizedDocs) {
    if (!doc || typeof doc !== 'object') {
      continue;
    }
    const rawId = doc.id ?? doc.item_id ?? doc.itemId;
    const numericId = Number.isFinite(rawId) ? Number(rawId) : Number.parseInt(rawId, 10);
    if (Number.isInteger(numericId) && numericId > 0) {
      docMap.set(numericId, doc);
    }
  }

  const rawFields = parseMarketCsvFieldList(url.searchParams);
  const fieldSet = new Set();
  const orderedFields = [];
  const candidateFields = rawFields.length > 0 ? rawFields : DEFAULT_MARKET_CSV_FIELDS;
  candidateFields.forEach((field) => {
    if (!field) {
      return;
    }
    const normalized = String(field).trim();
    if (!normalized) {
      return;
    }
    if (!fieldSet.has(normalized)) {
      fieldSet.add(normalized);
      orderedFields.push(normalized);
    }
  });
  if (orderedFields.length === 0) {
    DEFAULT_MARKET_CSV_FIELDS.forEach((field) => {
      if (!fieldSet.has(field)) {
        fieldSet.add(field);
        orderedFields.push(field);
      }
    });
  }

  const lines = [orderedFields.join(',')];
  const includedDocs = [];
  for (const id of ids) {
    const doc = docMap.get(id);
    if (!doc) {
      continue;
    }
    includedDocs.push(doc);
    const row = orderedFields.map((field) => formatCsvValue(resolveMarketFieldValue(doc, field)));
    lines.push(row.join(','));
  }

  const body = lines.join('\n');
  const etag = `"${crypto.createHash('sha1').update(body).digest('hex')}"`;
  const lastModifiedDate = getLatestLastModified(includedDocs);
  const headers = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Cache-Control': `public, max-age=${CACHE_TTL_FAST_SECONDS}, stale-while-revalidate=${CACHE_TTL_FAST_SECONDS}`,
    ETag: etag,
  };
  if (lastModifiedDate) {
    headers['Last-Modified'] = lastModifiedDate.toUTCString();
  }

  if (shouldReturnNotModified(req.headers, etag, lastModifiedDate)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  headers['Content-Length'] = Buffer.byteLength(body);
  res.writeHead(200, headers);
  res.end(body);
}

async function handlePricesRequest(req, res, url) {
  const ids = parseNumericParamList(url.searchParams, 'ids');
  if (ids.length === 0) {
    fail(res, 400, 'ids_required', 'ids required', {
      lang: DEFAULT_LANG,
      source: 'prices',
      stale: false,
    });
    return;
  }

  let documents = [];
  try {
    const client = await getMongoClient();
    if (!client || typeof client.db !== 'function') {
      throw new Error('mongo client unavailable');
    }
    const collection = client.db().collection('prices');
    const cursor = collection.find({ id: { $in: ids } }, { projection: { _id: 0 } });
    documents = await cursor.toArray();
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[api] failed to read market prices: ${err.message}`);
    }
    fail(res, 503, 'market_unavailable', 'Market data unavailable', {
      lang: DEFAULT_LANG,
      source: 'prices',
      stale: true,
    });
    return;
  }

  const sanitizedDocs = new Map();
  if (Array.isArray(documents)) {
    for (const doc of documents) {
      const sanitized = sanitizeMarketDocument(doc);
      if (!sanitized || typeof sanitized !== 'object') {
        continue;
      }
      const rawId = sanitized.id ?? sanitized.item_id ?? sanitized.itemId;
      const numericId = Number.isFinite(rawId) ? Number(rawId) : Number.parseInt(rawId, 10);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        continue;
      }
      sanitized.id = numericId;
      sanitizedDocs.set(numericId, sanitized);
    }
  }

  const orderedDocs = [];
  for (const id of ids) {
    if (sanitizedDocs.has(id)) {
      orderedDocs.push(sanitizedDocs.get(id));
    }
  }

  ok(res, orderedDocs, {
    source: 'prices',
    stale: false,
    lang: DEFAULT_LANG,
    ids,
    count: orderedDocs.length,
  }, {
    headers: {
      'Cache-Control': `public, max-age=${CACHE_TTL_FAST_SECONDS}, stale-while-revalidate=${CACHE_TTL_FAST_SECONDS}`,
    },
  });
}

function sanitizeNestedRecipeDocument(doc) {
  return cloneAndFilterDocument(doc, ['lang', 'source']);
}

function normalizeRecipeTreeNode(node) {
  const sanitized = cloneAndFilterDocument(node, ['lang', 'source']);
  if (!sanitized || typeof sanitized !== 'object') {
    return null;
  }
  const { components, children, recipe, tree, ...rest } = sanitized;
  const rawChildren = Array.isArray(children)
    ? children
    : Array.isArray(components)
      ? components
      : Array.isArray(tree)
        ? tree
        : [];
  const normalizedChildren = rawChildren
    .map((child) => normalizeRecipeTreeNode(child))
    .filter((entry) => entry !== null);
  rest.children = normalizedChildren;
  if (recipe && typeof recipe === 'object') {
    rest.recipe = sanitizeRecipeDocument(recipe);
  }
  return rest;
}

function buildNestedRecipePayload(doc) {
  const sanitized = sanitizeNestedRecipeDocument(doc);
  if (!sanitized || typeof sanitized !== 'object') {
    return null;
  }

  const payload = {};
  if (sanitized.lastUpdated) {
    payload.lastUpdated = sanitized.lastUpdated;
  }

  const sources = [];
  if (Array.isArray(sanitized.tree)) {
    sources.push(...sanitized.tree);
  } else if (Array.isArray(sanitized.children)) {
    sources.push(...sanitized.children);
  } else if (Array.isArray(sanitized.components)) {
    sources.push(...sanitized.components);
  } else {
    sources.push(sanitized);
  }

  const normalizedTree = sources
    .map((entry) => normalizeRecipeTreeNode(entry))
    .filter((entry) => entry !== null);

  payload.tree = normalizedTree;
  return payload;
}

async function readRecipeDocument(client, itemId, lang) {
  if (!client || typeof client.db !== 'function') {
    return null;
  }

  const normalizedLang = normalizeLang(lang);
  const collection = client.db().collection('recipes');
  const cursor = collection
    .find({ output_item_id: Number(itemId) }, { projection: { _id: 0 } })
    .limit(5);
  const docs = await cursor.toArray();
  if (!Array.isArray(docs) || docs.length === 0) {
    return null;
  }

  let selected = null;
  for (const doc of docs) {
    if (!selected) {
      selected = doc;
    }
    if (doc && doc.lang === normalizedLang) {
      selected = doc;
      break;
    }
  }

  return sanitizeRecipeDocument(selected);
}

async function readMarketDocument(client, itemId) {
  if (!client || typeof client.db !== 'function') {
    return {};
  }

  const doc = await client
    .db()
    .collection('prices')
    .findOne({ id: Number(itemId) }, { projection: { _id: 0 } });
  if (!doc) {
    return {};
  }
  return sanitizeMarketDocument(doc);
}

async function readNestedRecipeDocument(client, itemId) {
  const cacheKey = String(itemId);
  let redis = null;
  try {
    redis = await getRedisClient();
  } catch (err) {
    redis = null;
  }

  if (redis && typeof redis.hGet === 'function') {
    try {
      const cached = await redis.hGet('recipeTrees', cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] failed to read recipe tree cache for ${itemId}: ${err.message}`);
      }
    }
  }

  if (!client || typeof client.db !== 'function') {
    return null;
  }

  const doc = await client
    .db()
    .collection('recipeTrees')
    .findOne({ id: Number(itemId) }, { projection: { _id: 0 } });
  if (!doc) {
    return null;
  }

  const payload = buildNestedRecipePayload(doc);
  if (!payload) {
    return null;
  }

  if (redis && typeof redis.hSet === 'function') {
    try {
      await redis.hSet('recipeTrees', cacheKey, JSON.stringify(payload));
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] failed to write recipe tree cache for ${itemId}: ${err.message}`);
      }
    }
  }

  return payload;
}

async function buildItemDetailsPayload(itemId, lang) {
  const snapshot = await readItemSnapshot(itemId, lang);
  if (!snapshot || !snapshot.item) {
    return { snapshot: null, payload: null };
  }

  const normalizedLang = normalizeLang(lang);
  const item = { ...snapshot.item };

  if (typeof item.name_en === 'undefined') {
    let englishName = null;
    if (normalizedLang === 'en') {
      englishName = item.name ?? null;
    } else {
      try {
        const englishSnapshot = await readItemSnapshot(itemId, 'en');
        if (englishSnapshot && englishSnapshot.item && englishSnapshot.item.name) {
          englishName = englishSnapshot.item.name;
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[api] failed to fetch english name for item ${itemId}: ${err.message}`);
        }
      }
    }
    item.name_en = englishName ?? null;
  }

  const client = await getMongoClient();
  const [recipe, market, nestedRecipe] = await Promise.all([
    readRecipeDocument(client, itemId, normalizedLang).catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] failed to fetch recipe for ${itemId}: ${err.message}`);
      }
      return null;
    }),
    readMarketDocument(client, itemId).catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] failed to fetch market for ${itemId}: ${err.message}`);
      }
      return {};
    }),
    readNestedRecipeDocument(client, itemId).catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] failed to fetch nested recipe for ${itemId}: ${err.message}`);
      }
      return null;
    }),
  ]);

  return {
    snapshot,
    payload: {
      item,
      recipe,
      market: market || {},
      nested_recipe: nestedRecipe ?? null,
    },
  };
}

async function readItemSnapshotDefault(itemId, lang) {
  const normalizedLang = normalizeLang(lang);
  const candidateLangs = buildCandidateLangs(normalizedLang);
  const redis = await getRedisClient();
  if (redis) {
    try {
      for (const candidate of candidateLangs) {
        const redisKey = candidate === DEFAULT_LANG ? 'items' : `items:${candidate}`;
        const cached = await redis.hGet(redisKey, String(itemId));
        if (!cached) {
          continue;
        }
        const parsed = JSON.parse(cached);
        return {
          item: sanitizeItemDocument(parsed),
          meta: {
            lastUpdated: parsed && parsed.lastUpdated ? parsed.lastUpdated : undefined,
            lang: parsed && parsed.lang ? parsed.lang : candidate,
            source: 'cache',
            stale: false,
          },
        };
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] redis read error for item ${itemId}: ${err.message}`);
      }
    }
  }

  const client = await getMongoClient();
  const collection = client.db().collection('items');
  const cursor = collection
    .find(
      { id: Number(itemId), lang: { $in: candidateLangs.length ? candidateLangs : [normalizedLang] } },
      { projection: { _id: 0 } },
    )
    .limit(Math.max(candidateLangs.length || 0, 2));
  const documents = await cursor.toArray();
  if (!documents.length) {
    const fallbackSnapshot = await fetchItemSnapshotViaFallback({
      itemId,
      requestedLang: normalizedLang,
      candidateLangs,
      mongoClient: client,
      redisClient: redis,
    });
    return fallbackSnapshot;
  }

  let selected = null;
  for (const candidate of candidateLangs) {
    const doc = documents.find((entry) => {
      const docLang = typeof entry.lang === 'string'
        ? entry.lang.trim().toLowerCase()
        : DEFAULT_LANG;
      return docLang === candidate;
    });
    if (doc) {
      selected = doc;
      break;
    }
  }

  if (!selected) {
    selected = documents[0];
  }

  return {
    item: sanitizeItemDocument(selected),
    meta: {
      lastUpdated: selected.lastUpdated instanceof Date ? selected.lastUpdated.toISOString() : selected.lastUpdated,
      lang: selected.lang || normalizedLang,
      source: 'database',
      stale: false,
    },
  };
}

let readItemSnapshot = readItemSnapshotDefault;

function httpRequestJson(urlString, { timeoutMs = ITEM_FALLBACK_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const requestFn = isHttps ? https.request : http.request;
    const options = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search || ''}`,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gw2-v15-api/1.0 (+https://gw2crafts.net)',
      },
    };

    const req = requestFn(options, (res) => {
      const { statusCode } = res;
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (statusCode >= 200 && statusCode < 300) {
          if (!body) {
            resolve({ statusCode, data: null, raw: body });
            return;
          }
          try {
            const data = JSON.parse(body);
            resolve({ statusCode, data, raw: body });
          } catch (err) {
            const parseErr = new Error('Invalid JSON response');
            parseErr.statusCode = statusCode;
            parseErr.body = body;
            reject(parseErr);
          }
          return;
        }

        if (statusCode === 404) {
          resolve({ statusCode, data: null, raw: body });
          return;
        }

        const error = new Error(`Request failed with status ${statusCode}`);
        error.statusCode = statusCode;
        error.body = body;
        reject(error);
      });
    });

    req.on('error', reject);

    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        const timeoutError = new Error('Request timeout');
        timeoutError.code = 'ETIMEDOUT';
        req.destroy(timeoutError);
      });
    }

    req.end();
  });
}

async function persistFallbackItemDocument({ mongoClient, redisClient, document }) {
  if (!document || typeof document !== 'object') {
    return;
  }

  let client = mongoClient;
  if (!client) {
    client = await getMongoClient();
  }

  const collection = client.db().collection('items');
  await collection.updateOne(
    { id: Number(document.id), lang: document.lang },
    { $set: document },
    { upsert: true },
  );

  let redis = redisClient;
  if (!redis) {
    try {
      redis = await getRedisClient();
    } catch (err) {
      redis = null;
    }
  }

  if (redis && typeof redis.hSet === 'function') {
    try {
      const redisKey = getRedisKeyForLang(document.lang);
      await redis.hSet(redisKey, String(document.id), JSON.stringify(document));
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] failed to cache fallback item ${document.id} in redis: ${err.message}`);
      }
    }
  }
}

async function recordItemFallbackMetric(metric, mongoClient) {
  try {
    const client = mongoClient || (await getMongoClient());
    const payload = {
      endpoint: 'item-fallback',
      itemId: Number.isFinite(Number(metric?.itemId)) ? Number(metric.itemId) : null,
      requestedLang: metric?.requestedLang ? String(metric.requestedLang) : null,
      lang: metric?.lang ? String(metric.lang) : null,
      statusCode: Number.isFinite(metric?.statusCode) ? Number(metric.statusCode) : null,
      durationMs: Number.isFinite(metric?.durationMs) ? Number(metric.durationMs) : null,
      success: Boolean(metric?.success),
      source: metric?.source ? String(metric.source) : 'external',
      error: metric?.error ? clampString(metric.error, 256) : null,
      createdAt: new Date(),
    };
    await client.db().collection(METRICS_COLLECTION).insertOne(payload);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[api] failed to record item fallback metric: ${err.message}`);
    }
  }
}

async function requestRemoteItem(itemId, lang) {
  const url = new URL(`${GW2_ITEM_ENDPOINT}/${encodeURIComponent(itemId)}`);
  if (lang) {
    url.searchParams.set('lang', lang);
  }
  return httpRequestJson(url.href, { timeoutMs: ITEM_FALLBACK_TIMEOUT_MS });
}

async function attemptFallbackItemFetch({
  itemId,
  requestedLang,
  lang,
  mongoClient,
  redisClient,
}) {
  const normalizedLang = normalizeLang(lang);
  const normalizedRequestedLang = normalizeLang(requestedLang);
  const numericId = Number(itemId);
  if (!Number.isFinite(numericId)) {
    return null;
  }

  let statusCode = null;
  let success = false;
  let errorMessage = null;
  let result = null;
  const start = Date.now();

  try {
    const response = await requestRemoteItem(numericId, normalizedLang);
    statusCode = response.statusCode;

    if (!response.data) {
      errorMessage = statusCode === 404 ? 'not_found' : 'empty_body';
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[api] fallback item ${numericId}/${normalizedLang} returned no data (status ${statusCode ?? 'unknown'})`,
        );
      }
      return null;
    }

    if (typeof response.data !== 'object') {
      errorMessage = 'invalid_payload';
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] fallback item ${numericId}/${normalizedLang} returned invalid payload`);
      }
      return null;
    }

    const now = new Date();
    const document = {
      ...response.data,
      id: Number.isFinite(Number(response.data.id)) ? Number(response.data.id) : numericId,
      lang: normalizedLang,
      source: 'external:fallback',
      lastUpdated: now,
      fallback: {
        requestedLang: normalizedRequestedLang,
        resolvedLang: normalizedLang,
        via: 'remote',
      },
    };

    await persistFallbackItemDocument({ mongoClient, redisClient, document });

    const sanitized = sanitizeItemDocument(document);
    const meta = {
      lastUpdated: sanitized?.lastUpdated || now.toISOString(),
      lang: sanitized?.lang || normalizedLang,
      source: 'fallback',
      stale: false,
      fallback: {
        requestedLang: normalizedRequestedLang,
        resolvedLang: normalizedLang,
      },
    };

    if (process.env.NODE_ENV !== 'test') {
      console.info(`[api] fetched fallback item ${numericId} (${normalizedLang}) from remote API`);
    }

    result = { item: sanitized, meta };
    success = true;
    return result;
  } catch (err) {
    if (statusCode == null && err && err.statusCode) {
      statusCode = err.statusCode;
    }
    errorMessage = err && err.message ? err.message : 'unknown_error';
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[api] fallback fetch for item ${numericId}/${normalizedLang} failed: ${errorMessage}`);
    }
  } finally {
    const durationMs = Date.now() - start;
    await recordItemFallbackMetric(
      {
        itemId: numericId,
        requestedLang: normalizedRequestedLang,
        lang: normalizedLang,
        statusCode,
        durationMs,
        success,
        source: 'external',
        error: success ? null : errorMessage,
      },
      mongoClient,
    );
  }

  return success ? result : null;
}

async function fetchItemSnapshotViaFallback({
  itemId,
  requestedLang,
  candidateLangs,
  mongoClient,
  redisClient,
}) {
  if (process.env.NODE_ENV === 'test' && process.env.API_ENABLE_ITEM_FALLBACK_IN_TESTS !== 'true') {
    return null;
  }

  const normalizedRequestedLang = normalizeLang(requestedLang);
  const languages = Array.isArray(candidateLangs) && candidateLangs.length
    ? Array.from(new Set(candidateLangs.map((entry) => normalizeLang(entry))))
    : [normalizedRequestedLang];

  let client = mongoClient;
  if (!client) {
    client = await getMongoClient();
  }

  let redis = redisClient;
  if (!redis) {
    try {
      redis = await getRedisClient();
    } catch (err) {
      redis = null;
    }
  }

  for (const lang of languages) {
    const snapshot = await attemptFallbackItemFetch({
      itemId,
      requestedLang: normalizedRequestedLang,
      lang,
      mongoClient: client,
      redisClient: redis,
    });
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

async function handleGetItem(res, itemId, lang) {
  try {
    const { snapshot, payload } = await buildItemDetailsPayload(itemId, lang);
    if (!snapshot || !payload || !payload.item) {
      ok(
        res,
        null,
        {
          lang: normalizeLang(lang),
          itemId,
          source: 'local',
          lastUpdated: null,
          stale: false,
        },
        {
          statusCode: 200,
          errors: [{ code: 'not_found', msg: 'Item not found' }],
          headers: {
            'Cache-Control': `public, max-age=${CACHE_TTL_FAST_SECONDS}, stale-while-revalidate=${CACHE_TTL_FAST_SECONDS}`,
          },
        },
      );
      return;
    }

    const snapshotMeta = snapshot.meta || {};
    const normalizedLang = snapshotMeta.lang ?? normalizeLang(lang);
    const meta = {
      ...snapshotMeta,
      lang: normalizedLang,
      lastUpdated: snapshotMeta.lastUpdated ?? null,
      source: snapshotMeta.source ?? 'local',
      itemId,
      stale: false,
    };

    ok(res, payload, meta, {
      headers: {
        'Cache-Control': `public, max-age=${CACHE_TTL_FAST_SECONDS}, stale-while-revalidate=${CACHE_TTL_FAST_SECONDS}`,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[api] failed to fetch item ${itemId}: ${err.message}`);
    }
    fail(res, 500, 'errorUnexpected', 'Unexpected error retrieving item', {
      lang,
      itemId,
      source: 'local',
      stale: true,
    });
  }
}

function computePercentile(sortedValues, percentile) {
  if (!sortedValues.length) {
    return null;
  }
  const p = Math.min(Math.max(percentile, 0), 1);
  const index = Math.ceil(p * sortedValues.length) - 1;
  const safeIndex = Math.max(0, Math.min(sortedValues.length - 1, index));
  return sortedValues[safeIndex];
}

function computeAverage(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const total = values.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(total)) {
    return null;
  }
  return total / values.length;
}

async function recordAggregateMetric(metric) {
  try {
    const client = await getMongoClient();
    const collection = client.db().collection(METRICS_COLLECTION);
    const payload = {
      endpoint: 'aggregate',
      statusCode: Number.isFinite(metric.statusCode) ? Number(metric.statusCode) : null,
      stale: Boolean(metric.stale),
      durationMs: Number.isFinite(metric.durationMs) ? Number(metric.durationMs) : null,
      ttfbMs: Number.isFinite(metric.ttfbMs) ? Number(metric.ttfbMs) : null,
      responseSizeBytes: Number.isFinite(metric.responseSizeBytes)
        ? Number(metric.responseSizeBytes)
        : null,
      source: metric.source || null,
      cacheHit: typeof metric.cacheHit === 'boolean' ? metric.cacheHit : null,
      cacheMiss: typeof metric.cacheMiss === 'boolean' ? metric.cacheMiss : null,
      cacheStale: typeof metric.cacheStale === 'boolean' ? metric.cacheStale : null,
      cacheLookupMs: Number.isFinite(metric.cacheLookupMs) ? Number(metric.cacheLookupMs) : null,
      snapshotId: metric.snapshotId != null ? String(metric.snapshotId) : null,
      snapshotTtlMs: Number.isFinite(metric.snapshotTtlMs) ? Number(metric.snapshotTtlMs) : null,
      itemId: Number.isFinite(metric.itemId) ? Number(metric.itemId) : null,
      lang: metric.lang != null ? String(metric.lang) : null,
      cacheAgeMs: Number.isFinite(metric.cacheAgeMs) ? Number(metric.cacheAgeMs) : null,
      cacheStoredAt: Number.isFinite(metric.cacheStoredAt)
        ? new Date(metric.cacheStoredAt)
        : null,
      createdAt: new Date(),
    };
    await collection.insertOne(payload);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[api] failed to record aggregate metric: ${err.message}`);
    }
  }
}

const defaultRecordAggregateMetric = recordAggregateMetric;

function clampString(value, maxLength) {
  if (value == null) {
    return null;
  }
  const str = String(value);
  if (!str) {
    return null;
  }
  const trimmed = str.trim();
  if (!trimmed) {
    return null;
  }
  if (!maxLength || maxLength <= 0 || trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength);
}

function parseOptionalInteger(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) {
    return null;
  }
  return Math.round(candidate);
}

function sanitizeJsErrorMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const entries = Object.entries(meta);
  if (!entries.length) {
    return null;
  }
  const result = {};
  let count = 0;
  for (const [key, value] of entries) {
    if (count >= JS_ERROR_MAX_META_ENTRIES) {
      break;
    }
    const normalizedKey = clampString(key, 64);
    if (!normalizedKey) {
      continue;
    }
    if (value == null) {
      continue;
    }
    if (typeof value === 'string') {
      const normalizedValue = clampString(value, 256);
      if (normalizedValue != null) {
        result[normalizedKey] = normalizedValue;
        count += 1;
      }
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[normalizedKey] = value;
      count += 1;
      continue;
    }
    if (typeof value === 'boolean') {
      result[normalizedKey] = value;
      count += 1;
      continue;
    }
    try {
      const serialized = clampString(JSON.stringify(value), 256);
      if (serialized != null) {
        result[normalizedKey] = serialized;
        count += 1;
      }
    } catch (err) {
      // ignore serialization issues
    }
  }
  return count > 0 ? result : null;
}

function computeJsErrorFingerprint({ message, name, source, line, column }) {
  const hash = crypto.createHash('sha1');
  hash.update(String(name || ''));
  hash.update('|');
  hash.update(String(message || ''));
  hash.update('|');
  hash.update(String(source || ''));
  hash.update('|');
  hash.update(String(Number.isFinite(line) ? line : ''));
  hash.update('|');
  hash.update(String(Number.isFinite(column) ? column : ''));
  return hash.digest('hex');
}

function sanitizeJsErrorPayload(payload, context = {}) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const messageCandidates = [payload.message, payload.msg, payload.error?.message];
  let message = null;
  for (const candidate of messageCandidates) {
    const normalized = clampString(candidate, JS_ERROR_MAX_MESSAGE_LENGTH);
    if (normalized) {
      message = normalized;
      break;
    }
  }

  const stack = clampString(payload.stack || payload.error?.stack, JS_ERROR_MAX_STACK_LENGTH);
  if (!message && !stack) {
    return null;
  }

  const name = clampString(payload.name || payload.error?.name, 128);
  const source =
    clampString(payload.source || payload.filename || payload.fileName, JS_ERROR_MAX_URL_LENGTH) || null;
  const line = parseOptionalInteger(payload.line || payload.lineno || payload.lineNumber);
  const column = parseOptionalInteger(payload.column || payload.colno || payload.columnNumber);
  const pageUrl = clampString(payload.pageUrl || payload.url || payload.location, JS_ERROR_MAX_URL_LENGTH);
  const tags = Array.isArray(payload.tags)
    ? payload.tags
        .map((tag) => clampString(tag, 64))
        .filter((value) => value)
        .slice(0, 10)
    : null;
  const severity = clampString(payload.severity, 32);
  const release = clampString(payload.release || payload.version, 64);

  let occurredAt = null;
  const timestampCandidates = [
    payload.timestamp,
    payload.occurredAt,
    payload.time,
    payload.date,
    payload.error?.timestamp,
  ];
  for (const candidate of timestampCandidates) {
    if (!candidate) {
      continue;
    }
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      occurredAt = date;
      break;
    }
  }

  const now = context.now instanceof Date ? context.now : new Date();
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) {
    occurredAt = now;
  }

  const userAgent = clampString(context.userAgent || payload.userAgent, 256);
  const referer = clampString(context.referer || payload.referer, JS_ERROR_MAX_URL_LENGTH);
  const ip = clampString(context.ip, 64);
  const fingerprint =
    clampString(payload.fingerprint, 128) ||
    computeJsErrorFingerprint({ message, name, source, line, column });
  const meta = sanitizeJsErrorMeta(payload.meta || payload.context || null);

  return {
    message,
    stack,
    name,
    source,
    line,
    column,
    url: pageUrl || null,
    tags: tags && tags.length ? tags : null,
    severity: severity || null,
    release: release || null,
    occurredAt,
    userAgent,
    referer,
    ip,
    fingerprint,
    meta,
  };
}

async function recordJsErrorFrequency(timestamp, fingerprint) {
  const redis = await getRedisClient();
  if (!redis) {
    return;
  }
  try {
    const ts = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
    const normalizedTs = Number.isFinite(ts) ? ts : Date.now();
    const score = Math.floor(normalizedTs / 1000);
    const value = `${score}:${fingerprint || generateTraceId()}`;
    await redis.zAdd(JS_ERROR_REDIS_KEY, [{ score, value }]);
    const cutoffScore = Math.floor((Date.now() - JS_ERROR_WINDOW_MS) / 1000);
    if (Number.isFinite(cutoffScore)) {
      await redis.zRemRangeByScore(JS_ERROR_REDIS_KEY, 0, cutoffScore - 1);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[telemetry] redis error recording js error: ${err.message}`);
    }
  }
}

function isNamespaceNotFoundError(err) {
  return Boolean(
    err &&
      (err.codeName === 'NamespaceNotFound' || err.code === 26 || err.message?.includes('ns not found')),
  );
}

async function recordJsErrorEventDefault(event) {
  if (!event || typeof event !== 'object') {
    return;
  }
  const client = await getMongoClient();
  const db = client.db();
  const receivedAt = new Date();
  const occurredAt = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt);
  const normalizedOccurredAt = Number.isNaN(occurredAt.getTime()) ? receivedAt : occurredAt;

  const payload = {
    message: event.message || null,
    stack: event.stack || null,
    name: event.name || null,
    source: event.source || null,
    line: Number.isFinite(event.line) ? Number(event.line) : null,
    column: Number.isFinite(event.column) ? Number(event.column) : null,
    url: event.url || null,
    tags: Array.isArray(event.tags) && event.tags.length ? event.tags : null,
    severity: event.severity || null,
    release: event.release || null,
    fingerprint: event.fingerprint || null,
    userAgent: event.userAgent || null,
    referer: event.referer || null,
    ip: event.ip || null,
    meta: event.meta || null,
    occurredAt: normalizedOccurredAt,
    receivedAt,
    createdAt: receivedAt,
  };

  try {
    await db.collection(JS_ERROR_COLLECTION).insertOne(payload);
  } catch (err) {
    if (!isNamespaceNotFoundError(err)) {
      throw err;
    }
  }

  const statsCollection = db.collection(JS_ERROR_STATS_COLLECTION);
  const statsUpdate = {
    $inc: { totalCount: 1 },
    $set: {
      updatedAt: receivedAt,
      lastErrorAt: normalizedOccurredAt,
      lastMessage: payload.message,
      lastSource: payload.source || payload.url,
      lastStack: payload.stack || null,
      lastFingerprint: payload.fingerprint,
      lastUserAgent: payload.userAgent,
    },
    $setOnInsert: { createdAt: receivedAt },
  };

  try {
    await statsCollection.updateOne({ _id: 'global' }, statsUpdate, { upsert: true });
  } catch (err) {
    if (!isNamespaceNotFoundError(err)) {
      throw err;
    }
  }

  if (payload.fingerprint) {
    const fingerprintDocId = `fingerprint:${payload.fingerprint}`;
    const fingerprintUpdate = {
      $inc: { count: 1 },
      $set: {
        fingerprint: payload.fingerprint,
        message: payload.message,
        source: payload.source || payload.url,
        lastErrorAt: normalizedOccurredAt,
        updatedAt: receivedAt,
      },
      $setOnInsert: { createdAt: receivedAt },
    };
    try {
      await statsCollection.updateOne({ _id: fingerprintDocId }, fingerprintUpdate, { upsert: true });
    } catch (err) {
      if (!isNamespaceNotFoundError(err)) {
        throw err;
      }
    }
  }

  await recordJsErrorFrequency(normalizedOccurredAt, payload.fingerprint);
}

async function collectJsErrorMetricsDefault(db, windowStart, nowTs) {
  const windowStartDate = windowStart instanceof Date ? windowStart : new Date(windowStart);
  const cutoff = Number.isNaN(windowStartDate.getTime())
    ? new Date(Date.now() - JS_ERROR_WINDOW_MS)
    : windowStartDate;
  const errorsCollection = db.collection(JS_ERROR_COLLECTION);
  let count = 0;
  try {
    count = await errorsCollection.countDocuments({ receivedAt: { $gte: cutoff } });
  } catch (err) {
    if (!isNamespaceNotFoundError(err)) {
      throw err;
    }
  }

  const redis = await getRedisClient();
  if (redis) {
    try {
      const minScore = Math.floor(cutoff.getTime() / 1000);
      const redisCount = await redis.zCount(JS_ERROR_REDIS_KEY, minScore, '+inf');
      if (redisCount != null) {
        count = Number(redisCount) || 0;
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[telemetry] redis error fetching js error metrics: ${err.message}`);
      }
    }
  }

  const statsCollection = db.collection(JS_ERROR_STATS_COLLECTION);
  let globalStats = null;
  try {
    globalStats = await statsCollection.findOne({ _id: 'global' });
  } catch (err) {
    if (!isNamespaceNotFoundError(err)) {
      throw err;
    }
  }

  let top = [];
  try {
    const cursor = statsCollection
      .find({ fingerprint: { $exists: true } }, {
        projection: {
          _id: 0,
          fingerprint: 1,
          message: 1,
          source: 1,
          count: 1,
          lastErrorAt: 1,
        },
      })
      .sort({ count: -1, updatedAt: -1 })
      .limit(5);
    const docs = await cursor.toArray();
    top = docs.map((doc) => ({
      fingerprint: doc.fingerprint || null,
      count: Number(doc.count || 0) || 0,
      message: doc.message || null,
      source: doc.source || null,
      lastErrorAt: toIsoString(doc.lastErrorAt),
    }));
  } catch (err) {
    if (!isNamespaceNotFoundError(err)) {
      throw err;
    }
  }

  const windowMinutes = JS_ERROR_WINDOW_MS / 60000;
  const perMinute = windowMinutes > 0 ? count / windowMinutes : null;
  const lastErrorAtIso = toIsoString(globalStats && globalStats.lastErrorAt);
  let lastErrorAgeMinutes = null;
  if (lastErrorAtIso) {
    const ts = Date.parse(lastErrorAtIso);
    const referenceTs = Number.isFinite(nowTs) ? nowTs : Date.now();
    if (Number.isFinite(ts)) {
      lastErrorAgeMinutes = Math.max(0, (referenceTs - ts) / 60000);
    }
  }

  return {
    windowMinutes,
    count,
    perMinute,
    lastErrorAt: lastErrorAtIso,
    lastErrorAgeMinutes,
    lastMessage: globalStats && globalStats.lastMessage ? globalStats.lastMessage : null,
    lastSource: globalStats && globalStats.lastSource ? globalStats.lastSource : null,
    lastFingerprint: globalStats && globalStats.lastFingerprint ? globalStats.lastFingerprint : null,
    lastUserAgent: globalStats && globalStats.lastUserAgent ? globalStats.lastUserAgent : null,
    totalCount: Number(globalStats && globalStats.totalCount ? globalStats.totalCount : 0) || 0,
    top,
  };
}

const defaultRecordJsErrorEvent = recordJsErrorEventDefault;
let recordJsErrorEventFn = defaultRecordJsErrorEvent;
const defaultCollectJsErrorMetrics = collectJsErrorMetricsDefault;
let collectJsErrorMetricsFn = defaultCollectJsErrorMetrics;

function createAlertKey(alert) {
  if (!alert || !alert.type) {
    return 'unknown';
  }
  const parts = [String(alert.type)];
  if (alert.collection) {
    parts.push(String(alert.collection));
  }
  if (alert.itemId) {
    parts.push(String(alert.itemId));
  }
  if (alert.fingerprint) {
    parts.push(String(alert.fingerprint));
  }
  return parts.join('|');
}

function postAlertWebhook(urlString, payload) {
  return new Promise((resolve, reject) => {
    if (!urlString) {
      resolve();
      return;
    }
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }

    const body = JSON.stringify(payload || {});
    const isHttps = parsed.protocol === 'https:';
    const requestFn = isHttps ? https.request : http.request;
    const options = {
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search || ''}`,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    if (parsed.username || parsed.password) {
      options.auth = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
    }

    const req = requestFn(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Webhook responded with status ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function dispatchOperationalAlert(alert) {
  if (!alert || !alert.type) {
    return;
  }

  if (process.env.NODE_ENV !== 'test') {
    console.warn(`[alert] ${alert.type}: ${alert.message}`);
  }

  if (!ALERT_WEBHOOK_URL) {
    return;
  }

  const key = createAlertKey(alert);
  const now = Date.now();
  const lastSent = alertNotificationState.get(key) || 0;
  if (ALERT_WEBHOOK_COOLDOWN_MS > 0 && now - lastSent < ALERT_WEBHOOK_COOLDOWN_MS) {
    return;
  }

  alertNotificationState.set(key, now);
  try {
    await postAlertWebhook(ALERT_WEBHOOK_URL, {
      ...alert,
      triggeredAt: new Date(now).toISOString(),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[alert] webhook dispatch failed: ${err.message}`);
    }
  }
}

function countFailuresSince(status, sinceDate) {
  if (!status || !Array.isArray(status.failures) || !sinceDate) {
    return 0;
  }
  const threshold = sinceDate instanceof Date ? sinceDate.getTime() : new Date(sinceDate).getTime();
  if (!Number.isFinite(threshold)) {
    return 0;
  }
  return status.failures.reduce((acc, entry) => {
    if (!entry || !entry.at) {
      return acc;
    }
    const ts = entry.at instanceof Date ? entry.at.getTime() : new Date(entry.at).getTime();
    if (!Number.isFinite(ts)) {
      return acc;
    }
    return ts >= threshold ? acc + 1 : acc;
  }, 0);
}

function countFailuresSinceLastSuccess(status) {
  if (!status || !Array.isArray(status.failures)) {
    return 0;
  }
  const lastSuccess = status.lastSuccess instanceof Date
    ? status.lastSuccess.getTime()
    : new Date(status.lastSuccess || status.lastSync || 0).getTime();
  return status.failures.reduce((acc, entry) => {
    if (!entry || !entry.at) {
      return acc;
    }
    const ts = entry.at instanceof Date ? entry.at.getTime() : new Date(entry.at).getTime();
    if (!Number.isFinite(ts)) {
      return acc;
    }
    if (!Number.isFinite(lastSuccess) || ts > lastSuccess) {
      return acc + 1;
    }
    return acc;
  }, 0);
}

async function fetchCollectionSummary(db, name, status, failureCutoff, nowTs) {
  const collection = db.collection(name);
  let count = 0;
  try {
    count = await collection.countDocuments();
  } catch (err) {
    if (!err || (err.codeName !== 'NamespaceNotFound' && err.code !== 26)) {
      throw err;
    }
  }

  let lastUpdated = null;
  if (status) {
    lastUpdated = status.lastSuccess || status.lastSync || status.lastRun || status.updatedAt || null;
  }
  if (!lastUpdated) {
    try {
      const latestDoc = await collection
        .find({}, { projection: { lastUpdated: 1, updatedAt: 1, _id: 0 } })
        .sort({ lastUpdated: -1, updatedAt: -1 })
        .limit(1)
        .next();
      if (latestDoc) {
        lastUpdated = latestDoc.lastUpdated || latestDoc.updatedAt || null;
      }
    } catch (err) {
      if (!err || (err.codeName !== 'NamespaceNotFound' && err.code !== 26)) {
        throw err;
      }
    }
  }

  const failures24h = countFailuresSince(status, failureCutoff);

  const lastUpdatedIso = toIsoString(lastUpdated);
  let ageMinutes = null;
  const referenceTs = Number.isFinite(nowTs)
    ? nowTs
    : Date.now();
  if (lastUpdatedIso) {
    const lastUpdatedTs = Date.parse(lastUpdatedIso);
    if (Number.isFinite(lastUpdatedTs)) {
      ageMinutes = Math.max(0, (referenceTs - lastUpdatedTs) / 60000);
    }
  }

  return {
    collection: name,
    count,
    lastUpdated: lastUpdatedIso,
    lastSuccess: toIsoString(status && status.lastSuccess),
    lastSync: toIsoString(status && status.lastSync),
    failures24h,
    lastUpdatedAgeMinutes: ageMinutes,
  };
}

function extractAdminToken(req) {
  if (req.headers == null) {
    return null;
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      const token = trimmed.slice(7).trim();
      if (token) {
        return token;
      }
    }
  }
  const direct = req.headers['x-admin-token'];
  if (typeof direct === 'string' && direct.trim() !== '') {
    return direct.trim();
  }
  return null;
}

async function buildDashboardSnapshot() {
  const client = await getMongoClient();
  const db = client.db();

  const now = Date.now();
  const metricsSince = new Date(now - DASHBOARD_WINDOW_MS);
  const metricsCursor = db
    .collection(METRICS_COLLECTION)
    .find(
      {
        endpoint: 'aggregate',
        createdAt: { $gte: metricsSince },
      },
      {
        projection: {
          stale: 1,
          durationMs: 1,
          statusCode: 1,
          ttfbMs: 1,
          responseSizeBytes: 1,
          _id: 0,
        },
      },
    );
  const metrics = await metricsCursor.toArray();
  const totalResponses = metrics.length;
  const staleResponses = metrics.reduce((acc, entry) => (entry && entry.stale ? acc + 1 : acc), 0);
  const durations = metrics
    .map((entry) => (entry && Number.isFinite(entry.durationMs) ? Number(entry.durationMs) : null))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const p95 = computePercentile(durations, 0.95);
  const p99 = computePercentile(durations, 0.99);
  const ttfbValues = metrics
    .map((entry) => (entry && Number.isFinite(entry.ttfbMs) ? Number(entry.ttfbMs) : null))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const payloadSizes = metrics
    .map((entry) =>
      entry && Number.isFinite(entry.responseSizeBytes) ? Number(entry.responseSizeBytes) : null,
    )
    .filter((value) => value !== null)
    .sort((a, b) => a - b);

  const statusRecords = await db
    .collection(SYNC_STATUS_COLLECTION)
    .find({ collection: { $in: MONITORED_COLLECTIONS } })
    .toArray();
  const statusMap = new Map();
  for (const status of statusRecords) {
    if (status && status.collection) {
      statusMap.set(status.collection, status);
    }
  }

  const failureCutoff = new Date(now - 24 * 60 * 60 * 1000);
  const freshness = {};
  const ingestionByCollection = {};
  let totalIngestionFailures = 0;
  const alerts = [];
  const alertPromises = [];
  const registerAlert = (alert) => {
    if (!alert) {
      return;
    }
    alerts.push(alert);
    alertPromises.push(dispatchOperationalAlert(alert));
  };
  for (const name of MONITORED_COLLECTIONS) {
    const status = statusMap.get(name) || null;
    const summary = await fetchCollectionSummary(db, name, status, failureCutoff, now);
    freshness[name] = summary;
    ingestionByCollection[name] = summary.failures24h;
    totalIngestionFailures += summary.failures24h;
    if (
      summary.lastUpdatedAgeMinutes != null &&
      FRESHNESS_ALERT_THRESHOLD_MINUTES > 0 &&
      summary.lastUpdatedAgeMinutes > FRESHNESS_ALERT_THRESHOLD_MINUTES
    ) {
      registerAlert({
        type: 'freshness-stale',
        collection: name,
        ageMinutes: summary.lastUpdatedAgeMinutes,
        thresholdMinutes: FRESHNESS_ALERT_THRESHOLD_MINUTES,
        message: `La colección ${name} no se actualiza desde hace ${Math.round(
          summary.lastUpdatedAgeMinutes,
        )} minutos`,
      });
    }
  }

  const staleRatio = totalResponses > 0 ? staleResponses / totalResponses : null;
  if (staleRatio !== null && staleRatio > 0.1) {
    registerAlert({
      type: 'stale-responses',
      message: `Más del 10% de las respuestas en los últimos ${Math.round(
        DASHBOARD_WINDOW_MS / 60000,
      )} minutos fueron stale`,
      ratio: staleRatio,
    });
  }

  if (p95 !== null && p95 > 2000) {
    registerAlert({
      type: 'latency',
      message: `La latencia p95 (${Math.round(p95)}ms) supera el umbral de 2000ms`,
      p95,
    });
  }

  const pricesStatus = statusMap.get('prices');
  if (pricesStatus) {
    const failureStreak = countFailuresSinceLastSuccess(pricesStatus);
    if (failureStreak >= 3) {
      registerAlert({
        type: 'prices-stale',
        message: 'Los precios llevan más de 3 ciclos sin actualizarse',
        failureStreak,
      });
    }
  }

  let jsErrors = null;
  try {
    jsErrors = await collectJsErrorMetricsFn(db, new Date(now - JS_ERROR_WINDOW_MS), now);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[admin] failed to collect js error metrics: ${err.message}`);
    }
  }

  const normalizedJsErrors = {
    windowMinutes: JS_ERROR_WINDOW_MS / 60000,
    count: 0,
    perMinute: null,
    lastErrorAt: null,
    lastErrorAgeMinutes: null,
    lastMessage: null,
    lastSource: null,
    lastFingerprint: null,
    lastUserAgent: null,
    totalCount: 0,
    top: [],
    ...(jsErrors && typeof jsErrors === 'object' ? jsErrors : {}),
  };

  if (
    normalizedJsErrors.perMinute !== null &&
    Number.isFinite(JS_ERROR_ALERT_THRESHOLD_PER_MINUTE) &&
    JS_ERROR_ALERT_THRESHOLD_PER_MINUTE > 0 &&
    normalizedJsErrors.perMinute > JS_ERROR_ALERT_THRESHOLD_PER_MINUTE
  ) {
    registerAlert({
      type: 'js-error-rate',
      message: `La tasa de errores JS supera ${JS_ERROR_ALERT_THRESHOLD_PER_MINUTE.toFixed(
        2,
      )} por minuto`,
      perMinute: normalizedJsErrors.perMinute,
      windowMinutes: normalizedJsErrors.windowMinutes,
      lastMessage: normalizedJsErrors.lastMessage || null,
      lastSource: normalizedJsErrors.lastSource || null,
      fingerprint: normalizedJsErrors.lastFingerprint || null,
    });
  }

  await Promise.allSettled(alertPromises);

  return {
    generatedAt: new Date().toISOString(),
    windowMinutes: Math.round(DASHBOARD_WINDOW_MS / 60000),
    freshness,
    responses: {
      total: totalResponses,
      stale: staleResponses,
      ratio: staleRatio,
    },
    latency: {
      p95,
      p99,
      sampleCount: durations.length,
    },
    delivery: {
      ttfb: {
        average: computeAverage(ttfbValues),
        p95: computePercentile(ttfbValues, 0.95),
        p99: computePercentile(ttfbValues, 0.99),
        sampleCount: ttfbValues.length,
      },
      payload: {
        averageBytes: computeAverage(payloadSizes),
        p95Bytes: computePercentile(payloadSizes, 0.95),
        p99Bytes: computePercentile(payloadSizes, 0.99),
        sampleCount: payloadSizes.length,
      },
    },
    ingestionFailures: {
      total24h: totalIngestionFailures,
      byCollection: ingestionByCollection,
      windowHours: 24,
    },
    jsErrors: normalizedJsErrors,
    alerts,
  };
}

async function refreshDashboardSnapshot() {
  const snapshot = await buildDashboardSnapshot();
  await snapshotCache.set(DASHBOARD_CACHE_KEY, snapshot, {
    softTtlMs: DASHBOARD_CACHE_SOFT_MS,
    hardTtlMs: DASHBOARD_CACHE_HARD_MS,
    tags: ['dashboard'],
  });
  return snapshot;
}

function scheduleDashboardRefresh() {
  if (dashboardRefreshPromise) {
    return dashboardRefreshPromise;
  }
  dashboardRefreshPromise = refreshDashboardSnapshot()
    .catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[admin] dashboard refresh failed: ${err.message}`);
      }
      return null;
    })
    .finally(() => {
      dashboardRefreshPromise = null;
    });
  return dashboardRefreshPromise;
}

async function getDashboardSnapshotCached({ forceRefresh = false } = {}) {
  const cacheOptions = {
    softTtlMs: DASHBOARD_CACHE_SOFT_MS,
    hardTtlMs: DASHBOARD_CACHE_HARD_MS,
  };

  if (!forceRefresh) {
    const cached = await snapshotCache.get(DASHBOARD_CACHE_KEY, cacheOptions);
    if (cached && cached.value) {
      if (cached.stale) {
        scheduleDashboardRefresh();
      }
      return {
        snapshot: cached.value,
        stale: Boolean(cached.stale),
        cache: cached.metadata || null,
      };
    }
  }

  const refreshed = await scheduleDashboardRefresh();
  if (!refreshed) {
    return { snapshot: null, stale: true, cache: null };
  }

  const cached = await snapshotCache.get(DASHBOARD_CACHE_KEY, cacheOptions);
  if (cached && cached.value) {
    return {
      snapshot: cached.value,
      stale: Boolean(cached.stale),
      cache: cached.metadata || null,
    };
  }

  return { snapshot: refreshed, stale: false, cache: null };
}

async function invalidateDashboardSnapshotCache() {
  await snapshotCache.invalidate(DASHBOARD_CACHE_KEY);
}

async function handleTelemetryJsError(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, { maxBytes: JS_ERROR_BODY_LIMIT_BYTES });
  } catch (err) {
    if (err && err.message === 'PayloadTooLarge') {
      fail(res, 413, 'errorPayloadTooLarge', 'Payload exceeds allowed limit', {
        source: 'telemetry',
        stale: false,
        lang: DEFAULT_LANG,
      });
      return;
    }
    fail(res, 400, 'errorInvalidJson', 'Invalid JSON payload', {
      source: 'telemetry',
      stale: false,
      lang: DEFAULT_LANG,
    });
    return;
  }

  if (!body) {
    fail(res, 400, 'errorInvalidPayload', 'Payload must be a JSON object', {
      source: 'telemetry',
      stale: false,
      lang: DEFAULT_LANG,
    });
    return;
  }

  const userAgentHeader = req.headers?.['user-agent'];
  const refererHeader = req.headers?.referer || req.headers?.referrer;
  const forwardedFor = req.headers?.['x-forwarded-for'];
  let ip = null;
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    ip = forwardedFor.split(',')[0].trim();
  }
  if (!ip && req.socket && req.socket.remoteAddress) {
    ip = req.socket.remoteAddress;
  }

  const context = {
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : null,
    referer: typeof refererHeader === 'string' ? refererHeader : null,
    ip: ip || null,
    now: new Date(),
  };

  const payloads = Array.isArray(body)
    ? body
    : Array.isArray(body.events)
      ? body.events
      : [body];

  const sanitized = [];
  for (const entry of payloads) {
    const event = sanitizeJsErrorPayload(entry, context);
    if (event) {
      sanitized.push(event);
    }
  }

  if (!sanitized.length) {
    fail(res, 400, 'errorInvalidPayload', 'No se pudo interpretar el error recibido', {
      source: 'telemetry',
      stale: false,
      lang: DEFAULT_LANG,
    });
    return;
  }

  try {
    for (const event of sanitized) {
      // eslint-disable-next-line no-await-in-loop
      await recordJsErrorEventFn(event);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[telemetry] failed to persist js error: ${err.message}`);
    }
    fail(res, 500, 'errorTelemetryStorage', 'No se pudo registrar el evento de error', {
      source: 'telemetry',
      stale: true,
      lang: DEFAULT_LANG,
    });
    return;
  }

  ok(
    res,
    { accepted: sanitized.length },
    {
      source: 'telemetry',
      stale: false,
      lang: DEFAULT_LANG,
      lastUpdated: context.now.toISOString(),
    },
    { statusCode: 202 },
  );
}

async function handleAdminDashboardRequest(req, res) {
  if (!ADMIN_TOKEN) {
    fail(res, 503, 'errorAdminDashboardDisabled', 'Admin dashboard is disabled', {
      source: 'admin',
      stale: false,
      lang: DEFAULT_LANG,
    });
    return;
  }

  const provided = extractAdminToken(req);
  if (!provided || provided !== ADMIN_TOKEN) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="admin"');
    fail(
      res,
      401,
      'errorUnauthorized',
      'Admin token is missing or invalid',
      { source: 'admin', stale: false, lang: DEFAULT_LANG },
    );
    return;
  }

  try {
    const { snapshot, stale: snapshotStale } = await getDashboardSnapshotCached();
    if (!snapshot) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[admin] dashboard snapshot not available');
      }
      fail(res, 503, 'errorDashboardUnavailable', 'Dashboard snapshot not available', {
        source: 'admin',
        stale: true,
        lang: DEFAULT_LANG,
      });
      return;
    }
    ok(res, snapshot, {
      source: 'admin',
      stale: Boolean(snapshotStale),
      lang: DEFAULT_LANG,
      lastUpdated: snapshot.generatedAt,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[admin] failed to build dashboard: ${err.message}`);
    }
    fail(
      res,
      500,
      'errorUnexpected',
      'Unexpected error building admin dashboard',
      { source: 'admin', stale: true, lang: DEFAULT_LANG },
    );
  }
}

function mergeAggregateMeta(cachedMeta, overrides = {}) {
  const meta = { ...(cachedMeta || {}), ...overrides };
  const hasOverrideSnapshot = Object.prototype.hasOwnProperty.call(overrides, 'snapshotAt');
  const hasCachedSnapshot = cachedMeta
    ? Object.prototype.hasOwnProperty.call(cachedMeta, 'snapshotAt')
    : false;

  const normalizeSnapshot = (value) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    const iso = toIsoString(value);
    if (iso != null) {
      return iso;
    }
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }
    return typeof value === 'string' ? value : null;
  };

  let snapshotAt;
  if (hasOverrideSnapshot) {
    snapshotAt = normalizeSnapshot(overrides.snapshotAt);
    if (snapshotAt === undefined) {
      snapshotAt = null;
    }
  } else if (hasCachedSnapshot) {
    snapshotAt = normalizeSnapshot(cachedMeta.snapshotAt);
    if (snapshotAt === undefined) {
      snapshotAt = null;
    }
  } else if (cachedMeta && cachedMeta.generatedAt !== undefined) {
    snapshotAt = normalizeSnapshot(cachedMeta.generatedAt);
    if (snapshotAt === undefined) {
      snapshotAt = null;
    }
  } else {
    snapshotAt = normalizeSnapshot(meta.snapshotAt);
    if (snapshotAt === undefined) {
      snapshotAt = null;
    }
  }
  meta.snapshotAt = snapshotAt;
  const hasOverrideLastUpdated = Object.prototype.hasOwnProperty.call(
    overrides,
    'lastUpdated',
  );
  const hasCachedLastUpdated = cachedMeta
    ? Object.prototype.hasOwnProperty.call(cachedMeta, 'lastUpdated')
    : false;

  let lastUpdated;
  if (hasOverrideLastUpdated) {
    if (overrides.lastUpdated === null) {
      lastUpdated = null;
    } else {
      const normalized = toIsoString(overrides.lastUpdated);
      lastUpdated = normalized != null ? normalized : null;
    }
  } else if (hasCachedLastUpdated) {
    if (cachedMeta.lastUpdated === null) {
      lastUpdated = null;
    } else {
      const normalized = toIsoString(cachedMeta.lastUpdated);
      lastUpdated = normalized != null ? normalized : null;
    }
  } else if (cachedMeta && typeof cachedMeta.generatedAt === 'string') {
    const normalized = toIsoString(cachedMeta.generatedAt);
    lastUpdated = normalized != null ? normalized : cachedMeta.generatedAt;
  } else {
    lastUpdated = new Date().toISOString();
  }

  meta.lastUpdated = lastUpdated;
  if (cachedMeta && cachedMeta.warnings && !overrides.warnings) {
    meta.warnings = cachedMeta.warnings;
  }

  let errors = [];
  if (Array.isArray(cachedMeta?.errors)) {
    errors = errors.concat(cachedMeta.errors);
  }
  if (Array.isArray(overrides.errors)) {
    errors = errors.concat(overrides.errors);
  } else if (overrides.errors != null) {
    errors.push(overrides.errors);
  }

  delete meta.errors;

  return { meta, errors };
}

async function handleGetAggregate(req, res, itemId, lang, url) {
  const start = process.hrtime.bigint();
  let statusCode = 200;
  let stale = false;
  let source = 'aggregate';
  let cached = null;
  let cacheLookupMs = null;
  let cacheHit = false;
  let cacheStale = false;
  let cacheMetadata = null;
  let snapshotIdForMetrics = null;
  let snapshotTtlMs = null;
  let cacheAgeMs = null;
  let cacheStoredAt = null;
  const fields = aggregateHelpers.parseAggregateFields(url?.searchParams?.get('fields'));
  try {
    const cacheLookupStart = process.hrtime.bigint();
    cached = await getCachedAggregateFn(itemId, lang);
    cacheLookupMs = Number(process.hrtime.bigint() - cacheLookupStart) / 1e6;
    if (!Number.isFinite(cacheLookupMs) || cacheLookupMs < 0) {
      cacheLookupMs = null;
    }
    if (cached && cached.data) {
      cacheHit = true;
      cacheMetadata = cached.cache || null;
      cacheStale = Boolean(cacheMetadata?.stale) || Boolean(cached.meta?.stale);
      if (cacheMetadata) {
        cacheAgeMs = Number.isFinite(cacheMetadata.ageMs) ? cacheMetadata.ageMs : null;
        cacheStoredAt = Number.isFinite(cacheMetadata.storedAt) ? cacheMetadata.storedAt : null;
      }
      const expired = isAggregateExpiredFn(cached.meta);
      if (expired) {
        scheduleAggregateBuildFn(itemId, lang).catch((err) => {
          if (process.env.NODE_ENV !== 'test') {
            console.warn(`[api] aggregate rebuild failed for ${itemId}/${lang}: ${err.message}`);
          }
        });
      }

      stale = expired || cached.meta?.stale || false;
      cacheStale = cacheStale || stale;
      source = cached.meta?.source || 'aggregate';
      const { meta, errors } = mergeAggregateMeta(cached.meta, {
        lang,
        itemId,
        source: 'aggregate',
        stale,
      });
      const { headers, snapshotIso, snapshotId, ttlMs } = computeConditionalHeaders(meta, itemId, lang, {
        cache: cacheMetadata,
        stale,
      });
      if (!snapshotIdForMetrics) {
        snapshotIdForMetrics = snapshotId || resolveSnapshotId(meta);
      }
      if (ttlMs != null) {
        snapshotTtlMs = ttlMs;
      }
      const filteredData = aggregateHelpers.filterAggregateData(cached.data, fields);
      const hasData = Object.keys(filteredData || {}).length > 0;
      if (
        shouldSendNotModified(req, headers, snapshotIso, {
          stale,
          hasData,
        })
      ) {
        statusCode = 304;
        writeNotModified(res, headers);
        return;
      }
      ok(res, filteredData, meta, { errors, headers });
      statusCode = 200;
      return;
    }

    const buildPromise = buildItemAggregateFn(itemId, lang);
    scheduleAggregateBuildFn(itemId, lang).catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api] aggregate build failed for ${itemId}/${lang}: ${err.message}`);
      }
    });

    const maxBuildMs = Number(aggregateModule.MAX_AGGREGATION_MS);
    let timeoutId = null;
    let built = null;
    try {
      if (Number.isFinite(maxBuildMs) && maxBuildMs > 0) {
        built = await Promise.race([
          buildPromise,
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error('Aggregate build timeout'));
            }, maxBuildMs);
          }),
        ]);
      } else {
        built = await buildPromise;
      }
    } finally {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    }

    if (built && built.data) {
      stale = false;
      source = 'aggregate';
      const { meta, errors } = mergeAggregateMeta(built.meta, {
        lang,
        itemId,
        source: 'aggregate',
        stale: false,
      });
      const { headers, snapshotIso, snapshotId, ttlMs } = computeConditionalHeaders(meta, itemId, lang, {
        cache: null,
        stale: false,
      });
      if (!snapshotIdForMetrics) {
        snapshotIdForMetrics = snapshotId || resolveSnapshotId(meta);
      }
      if (ttlMs != null) {
        snapshotTtlMs = ttlMs;
      }
      const filteredData = aggregateHelpers.filterAggregateData(built.data, fields);
      const hasData = Object.keys(filteredData || {}).length > 0;
      if (
        shouldSendNotModified(req, headers, snapshotIso, {
          stale: false,
          hasData,
        })
      ) {
        statusCode = 304;
        writeNotModified(res, headers);
        return;
      }
      ok(res, filteredData, meta, { errors, headers });
      statusCode = 200;
      return;
    }

    stale = false;
    statusCode = 200;
    ok(
      res,
      null,
      { lang, itemId, source: 'aggregate', stale: false, lastUpdated: null },
      {
        errors: [{ code: 'not_found', msg: 'Aggregate snapshot not available' }],
      },
    );
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[api] unable to retrieve aggregate for ${itemId}/${lang}: ${err.message}`);
    }
    scheduleAggregateBuildFn(itemId, lang).catch(() => {});
    if (cached && cached.data) {
      stale = true;
      source = cached.meta?.source || 'aggregate';
      statusCode = 200;
      const fallbackSnapshotAt =
        cached.meta?.snapshotAt ?? cached.meta?.generatedAt ?? cached.meta?.lastUpdated ?? null;
      const { meta, errors } = mergeAggregateMeta(cached.meta, {
        lang,
        itemId,
        source: 'aggregate',
        stale: true,
        snapshotAt: fallbackSnapshotAt,
        errors: ['aggregateFallback'],
      });
      const { headers, snapshotId, ttlMs } = computeConditionalHeaders(meta, itemId, lang, {
        cache: cacheMetadata,
        stale: true,
      });
      cacheStale = true;
      if (!snapshotIdForMetrics) {
        snapshotIdForMetrics = snapshotId || resolveSnapshotId(meta);
      }
      if (ttlMs != null) {
        snapshotTtlMs = ttlMs;
      } else {
        snapshotTtlMs = 0;
      }
      ok(res, cached.data, meta, { errors, headers });
    } else {
      stale = false;
      statusCode = 200;
      ok(
        res,
        null,
        { lang, itemId, source: 'aggregate', stale: false, lastUpdated: null },
        {
          errors: [
            { code: 'aggregate_failed', msg: 'Aggregate snapshot not available' },
          ],
        },
      );
    }
  } finally {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    const context = getResponseContext(res);
    const responseMetrics =
      context && context.__responseMetrics ? context.__responseMetrics : null;
    const metricsFirstByte = responseMetrics?.firstByteAt ?? null;
    const responseSizeBytes = Number.isFinite(responseMetrics?.responseSizeBytes)
      ? Number(responseMetrics.responseSizeBytes)
      : null;
    const ttfbMs =
      metricsFirstByte != null ? Number(metricsFirstByte - start) / 1e6 : null;
    recordAggregateMetric({
      statusCode,
      stale,
      durationMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
      ttfbMs: Number.isFinite(ttfbMs) && ttfbMs >= 0 ? ttfbMs : null,
      responseSizeBytes:
        Number.isFinite(responseSizeBytes) && responseSizeBytes >= 0
          ? responseSizeBytes
          : null,
      source,
      cacheHit,
      cacheMiss: !cacheHit,
      cacheStale,
      cacheLookupMs,
      snapshotId: snapshotIdForMetrics,
      snapshotTtlMs,
      itemId: Number(itemId),
      lang: normalizeLang(lang),
      cacheAgeMs,
      cacheStoredAt,
    });
  }
}

async function handleGetItemBundle(req, res, url, lang) {
  const ids = parseNumericParamList(url.searchParams, 'ids');
  if (ids.length === 0) {
    fail(
      res,
      400,
      'ids_required',
      'ids required',
      {
        lang,
        source: 'aggregate',
        stale: false,
      },
    );
    return;
  }

  const aggregateResult = await aggregateHelpers.resolveAggregateEntries(ids, {
    lang,
    getCachedAggregate: getCachedAggregateFn,
    buildItemAggregate: buildItemAggregateFn,
    logger: console,
  });

  if (aggregateResult.resolved) {
    const normalizedIds = aggregateResult.ids;
    const { items, market } = aggregateHelpers.buildBundleFromEntries(
      normalizedIds,
      aggregateResult.entries,
    );
    const { meta, errors: errorsList } = aggregateHelpers.buildAggregateMeta({
      lang,
      source: 'aggregate',
      stale: aggregateResult.stale,
      warnings: aggregateResult.warnings,
      errors: aggregateResult.errors,
      snapshot: aggregateResult.snapshot,
    });

    ok(
      res,
      { items, market },
      meta,
      {
        errors: errorsList,
        headers: {
          'Cache-Control': `public, max-age=${CACHE_TTL_FAST_SECONDS}, stale-while-revalidate=${CACHE_TTL_FAST_SECONDS}`,
        },
      },
    );
    return;
  }

  if (process.env.NODE_ENV !== 'test') {
    console.warn(
      `[api] falling back to legacy bundle handler for ids ${ids.join(',')} (${lang})`,
    );
  }

  const originalWriteHead = res.writeHead;
  const originalEnd = res.end;
  const originalSetHeader = typeof res.setHeader === 'function' ? res.setHeader : null;
  let storedStatus = null;
  const storedHeaders = {};
  let responseEnded = false;

  res.setHeader = function setHeader(name, value) {
    storedHeaders[name] = value;
    return this;
  };

  res.writeHead = function writeHead(statusCode, headers = {}) {
    storedStatus = statusCode;
    Object.assign(storedHeaders, headers || {});
    return this;
  };

  res.end = function endProxy(chunk, encoding, cb) {
    if (responseEnded) {
      return originalEnd.call(this, chunk, encoding, cb);
    }

    let buffer = null;
    if (Buffer.isBuffer(chunk)) {
      buffer = chunk;
    } else if (typeof chunk === 'string') {
      buffer = Buffer.from(chunk, encoding);
    } else if (chunk == null) {
      buffer = Buffer.from('');
    } else {
      buffer = Buffer.from(String(chunk));
    }

    let finalBuffer = buffer;
    try {
      const payload = JSON.parse(buffer.toString('utf8') || '{}');
      if (payload && typeof payload === 'object') {
        const meta = { ...(payload.meta || {}) };
        meta.source = 'fallback';
        payload.meta = meta;
        finalBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
      }
    } catch (err) {
      finalBuffer = buffer;
    }

    storedHeaders['Content-Length'] = Buffer.byteLength(finalBuffer);

    originalWriteHead.call(this, storedStatus ?? 200, storedHeaders);
    responseEnded = true;
    return originalEnd.call(this, finalBuffer, undefined, cb);
  };

  try {
    await legacyBundleHandler(req, res, {
      url,
      lang,
      method: 'GET',
    });
  } finally {
    res.writeHead = originalWriteHead;
    res.end = originalEnd;
    if (originalSetHeader) {
      res.setHeader = originalSetHeader;
    } else {
      delete res.setHeader;
    }
  }
}

function sendAggregateBundleResponse(
  res,
  payload,
  { statusCode = 200, cacheControl, dataSource, headers: extraHeaders = {} } = {},
) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  };
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }
  if (dataSource) {
    headers['X-Data-Source'] = dataSource;
  }
  const body = JSON.stringify(payload);
  headers['Content-Length'] = Buffer.byteLength(body);
  res.writeHead(statusCode, headers);
  res.end(body);
}

async function fetchLegacyBundlePayload(ids, lang) {
  const url = new URL('http://localhost/api/items/bundle');
  if (ids.length > 0) {
    url.searchParams.set('ids', ids.join(','));
  }
  if (lang) {
    url.searchParams.set('lang', lang);
  }

  const headers = {};
  let statusCode = null;
  let bodyBuffer = Buffer.from('');

  const responseStub = {
    writeHead(code, incomingHeaders = {}) {
      statusCode = code;
      Object.assign(headers, incomingHeaders);
      return this;
    },
    setHeader(name, value) {
      headers[name] = value;
      return this;
    },
    end(chunk) {
      if (Buffer.isBuffer(chunk)) {
        bodyBuffer = chunk;
      } else if (typeof chunk === 'string') {
        bodyBuffer = Buffer.from(chunk, 'utf8');
      } else if (chunk == null) {
        bodyBuffer = Buffer.from('');
      } else {
        bodyBuffer = Buffer.from(String(chunk));
      }
      return this;
    },
  };

  await legacyBundleHandler(null, responseStub, {
    url,
    lang,
    method: 'GET',
  });

  const text = bodyBuffer.toString('utf8');
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      payload = null;
    }
  }

  return {
    statusCode: statusCode ?? 200,
    headers,
    payload,
  };
}

async function handleAggregateBundleJson(req, res, url, lang) {
  const ids = parseNumericParamList(url.searchParams, 'ids');
  if (ids.length === 0) {
    const meta = { lang, source: 'aggregate', stale: false };
    const payload = {
      priceMap: {},
      iconMap: {},
      rarityMap: {},
      meta,
      errors: [{ code: 'ids_required', msg: 'ids required' }],
    };
    sendAggregateBundleResponse(res, payload, {
      statusCode: 400,
      cacheControl: 'no-store, no-cache, must-revalidate',
      dataSource: meta.source,
    });
    return;
  }

  const fields = aggregateHelpers.parseBundleFields(url.searchParams.get('fields'));
  const { ids: pagedIds, pagination } = aggregateHelpers.paginateIds(ids, {
    page: url.searchParams.get('page'),
    pageSize: url.searchParams.get('pageSize'),
  });

  if (pagedIds.length === 0) {
    const { meta } = aggregateHelpers.buildAggregateMeta({
      lang,
      source: 'aggregate',
      stale: false,
    });
    const enrichedMeta = { ...meta, pagination };
    const emptyPayload = aggregateHelpers.filterAggregateBundlePayload(
      { priceMap: {}, iconMap: {}, rarityMap: {}, meta: enrichedMeta },
      fields,
    );
    sendAggregateBundleResponse(res, emptyPayload, {
      statusCode: 200,
      cacheControl: 'public, max-age=0, must-revalidate',
      dataSource: enrichedMeta.source,
    });
    return;
  }

  const aggregateResult = await aggregateHelpers.resolveAggregateEntries(pagedIds, {
    lang,
    getCachedAggregate: getCachedAggregateFn,
    buildItemAggregate: buildItemAggregateFn,
    logger: console,
  });

  if (aggregateResult.resolved) {
    const normalizedIds = aggregateResult.ids;
    const { priceMap, iconMap, rarityMap } = aggregateHelpers.buildMapsFromEntries(
      normalizedIds,
      aggregateResult.entries,
    );
    const { meta, errors } = aggregateHelpers.buildAggregateMeta({
      lang,
      source: 'aggregate',
      stale: aggregateResult.stale,
      warnings: aggregateResult.warnings,
      errors: aggregateResult.errors,
      snapshot: aggregateResult.snapshot,
    });
    const enrichedMeta = { ...meta, pagination };
    const payload = aggregateHelpers.filterAggregateBundlePayload(
      { priceMap, iconMap, rarityMap, meta: enrichedMeta },
      fields,
    );
    if (errors.length > 0) {
      payload.errors = errors;
    }
    sendAggregateBundleResponse(res, payload, {
      statusCode: 200,
      cacheControl: `public, max-age=${CACHE_TTL_FAST_SECONDS}, stale-while-revalidate=${CACHE_TTL_FAST_SECONDS}`,
      dataSource: enrichedMeta.source,
    });
    return;
  }

  const fallbackResult = await fetchLegacyBundlePayload(pagedIds, lang);
  const fallbackPayload = fallbackResult.payload;

  if (!fallbackPayload || fallbackResult.statusCode >= 400) {
    const meta = { lang, source: 'aggregate', stale: true, pagination };
    const payload = aggregateHelpers.filterAggregateBundlePayload(
      {
        priceMap: {},
        iconMap: {},
        rarityMap: {},
        meta,
        errors: [
          { code: 'aggregate_failed', msg: 'Aggregate snapshot not available' },
        ],
      },
      fields,
    );
    sendAggregateBundleResponse(res, payload, {
      statusCode: fallbackResult.statusCode >= 400 ? fallbackResult.statusCode : 502,
      cacheControl: 'no-store, no-cache, must-revalidate',
      dataSource: meta.source,
    });
    return;
  }

  const fallbackMeta = { ...(fallbackPayload.meta || {}) };
  const snapshotValue =
    fallbackMeta.snapshotAt ?? fallbackMeta.generatedAt ?? fallbackMeta.lastUpdated ?? null;
  const fallbackEntries = aggregateHelpers.createEntriesFromBundleData(
    pagedIds,
    fallbackPayload.data || {},
  );
  const { priceMap, iconMap, rarityMap } = aggregateHelpers.buildMapsFromEntries(
    pagedIds,
    fallbackEntries,
  );
  const { meta, errors } = aggregateHelpers.buildAggregateMeta({
    lang,
    source: 'fallback',
    stale: fallbackMeta.stale,
    warnings: fallbackMeta.warnings,
    errors: fallbackPayload.errors,
    snapshot: snapshotValue,
  });
  const enrichedMeta = { ...meta, pagination };
  const payload = aggregateHelpers.filterAggregateBundlePayload(
    { priceMap, iconMap, rarityMap, meta: enrichedMeta },
    fields,
  );
  if (errors.length > 0) {
    payload.errors = errors;
  }
  const fallbackCacheControl =
    fallbackResult.headers?.['Cache-Control'] || fallbackResult.headers?.['cache-control'];
  sendAggregateBundleResponse(res, payload, {
    statusCode: fallbackResult.statusCode ?? 200,
    cacheControl:
      fallbackCacheControl ||
      `public, max-age=${CACHE_TTL_FAST_SECONDS}, stale-while-revalidate=${CACHE_TTL_FAST_SECONDS}`,
    dataSource: enrichedMeta.source,
  });
}

async function handleApiRequest(req, res) {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (method === 'POST' && pathname === '/telemetry/js-error') {
    await handleTelemetryJsError(req, res);
    return;
  }

  if (pathname === '/admin/dashboard') {
    if (method !== 'GET') {
      fail(
        res,
        405,
        'errorUnsupportedMethod',
        'Method not allowed',
        { source: 'admin', stale: false, lang: DEFAULT_LANG },
      );
      return;
    }
    await handleAdminDashboardRequest(req, res);
    return;
  }

  if (method !== 'GET') {
    fail(
      res,
      405,
      'errorUnsupportedMethod',
      'Method not allowed',
      { source: 'local', stale: false, lang: DEFAULT_LANG },
    );
    return;
  }

  const lang = normalizeLang(url.searchParams.get('lang'));

  if (pathname === '/api/market.csv') {
    await handleMarketCsvRequest(req, res, url);
    return;
  }

  if (pathname === '/api/prices') {
    await handlePricesRequest(req, res, url);
    return;
  }

  if (pathname === '/api/aggregate/bundle') {
    await handleAggregateBundleJson(req, res, url, lang);
    return;
  }

  if (await legacyRouter.tryHandle(req, res, { url, method, lang })) {
    return;
  }

  if (pathname === '/api/items/bundle') {
    await handleGetItemBundle(req, res, url, lang);
    return;
  }

  const aggregateMatch = pathname.match(/^\/api\/items\/(\d+)\/aggregate$/);
  if (aggregateMatch) {
    const itemId = Number(aggregateMatch[1]);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      fail(
        res,
        400,
        'errorInvalidId',
        'Item id must be a positive integer',
        { source: 'aggregate', lang, stale: false },
      );
      return;
    }
    await handleGetAggregate(req, res, itemId, lang, url);
    return;
  }

  const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemMatch) {
    const itemId = Number(itemMatch[1]);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      fail(
        res,
        400,
        'errorInvalidId',
        'Item id must be a positive integer',
        { source: 'local', lang, stale: false },
      );
      return;
    }
    await handleGetItem(res, itemId, lang);
    return;
  }

  fail(
    res,
    404,
    'errorNotFound',
    'Endpoint not found',
    { source: 'local', lang, stale: false },
  );
}

function requestListener(req, res) {
  const context = {
    traceId: generateTraceId(),
    ts: new Date().toISOString(),
  };
  req[RESPONSE_CONTEXT_KEY] = context;
  res[RESPONSE_CONTEXT_KEY] = context;

  handleApiRequest(req, res).catch((err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[api] unhandled error', err);
    }
    fail(
      res,
      500,
      'errorUnexpected',
      'Unexpected API error',
      { source: 'local', stale: true, lang: DEFAULT_LANG },
    );
  });
}

module.exports = requestListener;
module.exports.handleApiRequest = handleApiRequest;
module.exports.handleGetItem = handleGetItem;
module.exports.handleGetAggregate = handleGetAggregate;
module.exports.handleGetItemBundle = handleGetItemBundle;
module.exports.handleAggregateBundleJson = handleAggregateBundleJson;
module.exports.normalizeLang = normalizeLang;
module.exports.ok = ok;
module.exports.fail = fail;
module.exports.buildDashboardSnapshot = buildDashboardSnapshot;
module.exports.getDashboardSnapshotCached = getDashboardSnapshotCached;
module.exports.invalidateDashboardSnapshotCache = invalidateDashboardSnapshotCache;
module.exports.__setLegacyOverrides = setLegacyOverrides;
module.exports.__resetLegacyOverrides = resetLegacyOverrides;

module.exports.__setAggregateOverrides = (overrides = {}) => {
  if (overrides.buildItemAggregate) {
    buildItemAggregateFn = overrides.buildItemAggregate;
  }
  if (overrides.getCachedAggregate) {
    getCachedAggregateFn = overrides.getCachedAggregate;
  }
  if (overrides.scheduleAggregateBuild) {
    scheduleAggregateBuildFn = overrides.scheduleAggregateBuild;
  }
  if (overrides.isAggregateExpired) {
    isAggregateExpiredFn = overrides.isAggregateExpired;
  }
};

module.exports.__resetAggregateOverrides = () => {
  buildItemAggregateFn = aggregateModule.buildItemAggregate;
  getCachedAggregateFn = aggregateModule.getCachedAggregate;
  scheduleAggregateBuildFn = aggregateModule.scheduleAggregateBuild;
  isAggregateExpiredFn = aggregateModule.isAggregateExpired;
};

module.exports.__setRecordAggregateMetric = (fn) => {
  if (typeof fn === 'function') {
    recordAggregateMetric = fn;
  }
};

module.exports.__resetRecordAggregateMetric = () => {
  recordAggregateMetric = defaultRecordAggregateMetric;
};

module.exports.__setJsErrorRecorder = (fn) => {
  if (typeof fn === 'function') {
    recordJsErrorEventFn = fn;
  }
};

module.exports.__resetJsErrorRecorder = () => {
  recordJsErrorEventFn = defaultRecordJsErrorEvent;
};

module.exports.__setCollectJsErrorMetrics = (fn) => {
  if (typeof fn === 'function') {
    collectJsErrorMetricsFn = fn;
  }
};

module.exports.__resetCollectJsErrorMetrics = () => {
  collectJsErrorMetricsFn = defaultCollectJsErrorMetrics;
};

module.exports.__setMongoClient = (client) => {
  mongoClientPromise = Promise.resolve(client);
};

module.exports.__resetMongoClient = () => {
  mongoClientPromise = null;
};

module.exports.__setRedisClient = (client) => {
  if (client) {
    redisClient = client;
    redisClientPromise = Promise.resolve(client);
  } else {
    redisClient = null;
    redisClientPromise = null;
  }
};

module.exports.__resetRedisClient = () => {
  redisClient = null;
  redisClientPromise = null;
};

Object.defineProperty(module.exports, 'readItemSnapshot', {
  configurable: true,
  enumerable: true,
  get() {
    return readItemSnapshot;
  },
  set(fn) {
    readItemSnapshot = typeof fn === 'function' ? fn : readItemSnapshotDefault;
  },
});

module.exports.__resetReadItemSnapshot = () => {
  readItemSnapshot = readItemSnapshotDefault;
};

if (require.main === module) {
  const server = http.createServer(requestListener);
  server.listen(API_PORT, API_HOST, () => {
    console.log(`[api] listening on http://${API_HOST}:${API_PORT}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
