import fetchWithRetry from './fetchWithRetry.js';
import { getItemBundles } from '../services/recipeService.js';
import { getConfig } from '../config.js';

function emitCacheMetric(metric) {
  if (typeof window === 'undefined' || !window) {
    return;
  }
  const allowed = new Set(['hit', 'miss', 'stale']);
  if (!allowed.has(metric)) {
    return;
  }
  const base = window.__cacheMetrics__ && typeof window.__cacheMetrics__ === 'object'
    ? {
        hit: Number(window.__cacheMetrics__.hit) || 0,
        miss: Number(window.__cacheMetrics__.miss) || 0,
        stale: Number(window.__cacheMetrics__.stale) || 0,
        lastUpdated: Number(window.__cacheMetrics__.lastUpdated) || 0,
      }
    : { hit: 0, miss: 0, stale: 0, lastUpdated: 0 };
  base[metric] += 1;
  base.lastUpdated = Date.now();
  window.__cacheMetrics__ = base;
  if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('cache-metrics', { detail: { ...base } }));
  }
}

function normalizeId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function normalizeFields(fields) {
  if (!fields) {
    return null;
  }
  if (Array.isArray(fields)) {
    return fields
      .map(field => String(field || '').trim())
      .filter(Boolean)
      .join(',');
  }
  if (typeof fields === 'string') {
    return fields
      .split(',')
      .map(field => field.trim())
      .filter(Boolean)
      .join(',');
  }
  return null;
}

function toFieldSet(fields) {
  const normalized = normalizeFields(fields);
  if (!normalized) {
    return null;
  }
  const set = new Set();
  normalized.split(',').forEach(field => {
    if (field) {
      set.add(field);
    }
  });
  return set;
}

function joinApiPath(baseUrl, path) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  const trimmedBase = base.replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  if (!trimmedBase) {
    return `/${normalizedPath}`;
  }
  if (!normalizedPath) {
    return trimmedBase || '/';
  }
  return `${trimmedBase}/${normalizedPath}`;
}

function normalizeLegacyMarketEntry(market) {
  if (!market || typeof market !== 'object') {
    return { buy_price: null, sell_price: null };
  }

  const parseNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  };

  const buy = [
    market.buy_price,
    market.buyPrice,
    market.buys?.unit_price,
    market.buy?.unit_price,
  ].map(parseNumber).find((value) => value != null);

  const sell = [
    market.sell_price,
    market.sellPrice,
    market.sells?.unit_price,
    market.sell?.unit_price,
  ].map(parseNumber).find((value) => value != null);

  return { buy_price: buy ?? null, sell_price: sell ?? null };
}

function extractLegacyTimestamp(entry) {
  const { extra } = entry && typeof entry === 'object' ? entry : {};
  const candidates = [
    extra?.last_updated,
    extra?.lastUpdated,
    extra?.lastUpdatedAt,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    if (Number.isFinite(millis) && millis > 0) {
      return millis;
    }
  }
  return null;
}

function normalizeLegacyItem(id, item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const normalizeString = (value) => {
    if (value == null) return null;
    const text = String(value).trim();
    return text ? text : null;
  };

  const normalizeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  return {
    id: Number.isFinite(Number(id)) ? Number(id) : normalizeNumber(item.id) ?? null,
    name: normalizeString(item.name),
    icon: normalizeString(item.icon),
    type: normalizeString(item.type),
    rarity: normalizeString(item.rarity),
    level: normalizeNumber(item.level),
  };
}

export async function buildLegacyAggregatePayload(ids, { lang, includePagination = false } = {}) {
  const normalizedLang = typeof lang === 'string' && lang.trim() ? lang.trim() : 'es';
  const lookupIds = ids.map((value) => normalizeId(value)).filter((value) => {
    if (value == null || value === '') {
      return false;
    }
    if (Number.isFinite(value)) {
      return value > 0;
    }
    const text = String(value).trim();
    return Boolean(text);
  });

  if (lookupIds.length === 0) {
    const meta = {
      source: 'fallback',
      lang: normalizedLang,
      stale: true,
      errors: [{ code: 'no_ids', msg: 'No item ids provided for legacy aggregate' }],
    };
    if (includePagination) {
      meta.pagination = { page: 1, pageSize: 0, totalPages: 1, hasNext: false };
    }
    return {
      priceMap: {},
      iconMap: {},
      rarityMap: {},
      itemMap: {},
      meta,
    };
  }

  let bundles;
  try {
    bundles = await getItemBundles(lookupIds);
  } catch (err) {
    const error = new Error('Legacy aggregate fallback failed');
    error.cause = err;
    throw error;
  }

  const priceMap = {};
  const iconMap = {};
  const rarityMap = {};
  const itemMap = {};
  const errors = [];
  let latestTimestamp = 0;

  lookupIds.forEach((rawId, index) => {
    const normalizedId = normalizeId(rawId);
    const numericId = Number.isFinite(Number(normalizedId)) ? Number(normalizedId) : null;
    const key = String(normalizedId);
    const bundle = Array.isArray(bundles) ? bundles[index] : null;

    if (!bundle || typeof bundle !== 'object') {
      priceMap[key] = { id: numericId ?? null, buy_price: null, sell_price: null };
      iconMap[key] = null;
      rarityMap[key] = null;
      itemMap[key] = null;
      errors.push({ code: 'missing_bundle', msg: `Missing bundle data for ${key}` });
      return;
    }

    const marketEntry = normalizeLegacyMarketEntry(bundle.market);
    priceMap[key] = {
      id: numericId ?? null,
      buy_price: marketEntry.buy_price,
      sell_price: marketEntry.sell_price,
    };

    const itemEntry = normalizeLegacyItem(normalizedId, bundle.item);
    iconMap[key] = itemEntry?.icon ?? null;
    rarityMap[key] = itemEntry?.rarity ?? null;
    itemMap[key] = itemEntry;

    const timestamp = extractLegacyTimestamp(bundle);
    if (timestamp && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  });

  const meta = {
    source: 'fallback',
    lang: normalizedLang,
    stale: true,
    warnings: [{ code: 'legacy_fallback', msg: 'Legacy bundle fallback used' }],
  };
  if (latestTimestamp > 0) {
    try {
      meta.lastUpdated = new Date(latestTimestamp).toISOString();
    } catch {
      meta.lastUpdated = undefined;
    }
  }
  if (errors.length > 0) {
    meta.errors = errors;
  }
  if (includePagination) {
    meta.pagination = {
      page: 1,
      pageSize: lookupIds.length,
      totalPages: 1,
      hasNext: false,
    };
  }

  return {
    priceMap,
    iconMap,
    rarityMap,
    itemMap,
    meta,
  };
}

async function fetchAggregateFromApi({
  requestUrl,
  signal,
  fields,
  normalizedIds,
  iconCache,
  rarityCache,
  itemCache,
}) {
  const response = await fetchWithRetry(requestUrl, {
    signal,
    headers: {
      Accept: 'application/json, text/plain;q=0.9',
    },
  });
  if (!response.ok) {
    const error = new Error(`Error ${response.status} al consultar el agregado de bundle`);
    error.code = 'AGGREGATE_HTTP_ERROR';
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (err) {
      const error = new Error(
        `Datos no válidos del agregado de bundle (content-type: ${contentType || 'desconocido'})`,
      );
      error.code = 'AGGREGATE_INVALID_JSON';
      error.cause = err;
      throw error;
    }
  }
  if (!payload || typeof payload !== 'object') {
    const error = new Error('Datos no válidos del agregado de bundle');
    error.code = 'AGGREGATE_INVALID_PAYLOAD';
    throw error;
  }

  const snapshotIdHeader = response.headers.get('X-Snapshot-Id');
  const ttlHeader = response.headers.get('X-Snapshot-TTL');
  const ttlSeconds = ttlHeader != null ? parseInt(ttlHeader, 10) : null;
  const staleHeader = response.headers.get('X-Snapshot-Stale');
  const dataSourceHeader = response.headers.get('X-Data-Source');

  const priceMap = new Map();
  const iconMap = new Map();
  const rarityMap = new Map();
  const itemMap = new Map();

  if (payload.priceMap && typeof payload.priceMap === 'object') {
    Object.entries(payload.priceMap).forEach(([id, value]) => {
      if (value && typeof value === 'object') {
        const normalizedId = normalizeId(id);
        priceMap.set(normalizedId, value);
      }
    });
  }

  if (payload.iconMap && typeof payload.iconMap === 'object') {
    Object.entries(payload.iconMap).forEach(([id, value]) => {
      const normalizedId = normalizeId(id);
      iconMap.set(normalizedId, value ?? null);
      if (iconCache && typeof iconCache === 'object') {
        iconCache[normalizedId] = value ?? null;
      }
    });
  }

  if (payload.rarityMap && typeof payload.rarityMap === 'object') {
    Object.entries(payload.rarityMap).forEach(([id, value]) => {
      const normalizedId = normalizeId(id);
      rarityMap.set(normalizedId, value ?? null);
      if (rarityCache && typeof rarityCache === 'object') {
        rarityCache[normalizedId] = value ?? null;
      }
    });
  }

  if (payload.itemMap && typeof payload.itemMap === 'object') {
    Object.entries(payload.itemMap).forEach(([id, value]) => {
      const normalizedId = normalizeId(id);
      if (value && typeof value === 'object') {
        itemMap.set(normalizedId, { ...value, id: normalizeId(value.id ?? normalizedId) });
        if (itemCache && typeof itemCache === 'object') {
          itemCache[normalizedId] = { ...value };
        }
      } else {
        itemMap.set(normalizedId, null);
        if (itemCache && typeof itemCache === 'object') {
          itemCache[normalizedId] = null;
        }
      }
    });
  }

  const normalizedIdsForValidation = normalizedIds;
  const hasErrors = Array.isArray(payload.errors)
    ? payload.errors.length > 0
    : Boolean(payload.errors);
  const fieldSet = toFieldSet(fields);
  const expectPriceMap = !fieldSet || fieldSet.has('priceMap');
  const expectIconMap = !fieldSet || fieldSet.has('iconMap');
  const expectRarityMap = !fieldSet || fieldSet.has('rarityMap');
  const expectItemMap = fieldSet ? fieldSet.has('itemMap') : false;

  const missingIds = normalizedIdsForValidation.filter((id) => {
    if (expectPriceMap && !priceMap.has(id)) return true;
    if (expectIconMap && !iconMap.has(id)) return true;
    if (expectRarityMap && !rarityMap.has(id)) return true;
    if (expectItemMap && !itemMap.has(id)) return true;
    return false;
  });

  if (hasErrors || missingIds.length > 0) {
    const error = new Error('Datos incompletos del agregado de bundle');
    error.code = 'AGGREGATE_INCOMPLETE';
    error.missingIds = missingIds;
    throw error;
  }

  const normalizedMeta = { ...(payload.meta || {}) };
  if (snapshotIdHeader && !normalizedMeta.snapshotId) {
    normalizedMeta.snapshotId = snapshotIdHeader;
  }
  if (Number.isFinite(ttlSeconds)) {
    normalizedMeta.snapshotTtl = ttlSeconds;
  }
  if (typeof staleHeader === 'string') {
    normalizedMeta.stale = staleHeader === '1' || normalizedMeta.stale === true;
  }
  if (dataSourceHeader && !normalizedMeta.source) {
    normalizedMeta.source = dataSourceHeader;
  }

  let metric = 'hit';
  if (normalizedMeta.source === 'fallback') {
    metric = 'miss';
  } else if (normalizedMeta.stale || (Number.isFinite(ttlSeconds) && ttlSeconds <= 0)) {
    metric = 'stale';
  }
  emitCacheMetric(metric);

  return {
    priceMap,
    iconMap,
    rarityMap,
    itemMap,
    meta: normalizedMeta,
  };
}

function convertLegacyPayloadToMaps(payload) {
  const priceMap = new Map();
  const iconMap = new Map();
  const rarityMap = new Map();
  const itemMap = new Map();

  Object.entries(payload.priceMap || {}).forEach(([id, value]) => {
    const normalizedId = normalizeId(id);
    priceMap.set(normalizedId, value);
  });
  Object.entries(payload.iconMap || {}).forEach(([id, value]) => {
    const normalizedId = normalizeId(id);
    iconMap.set(normalizedId, value ?? null);
  });
  Object.entries(payload.rarityMap || {}).forEach(([id, value]) => {
    const normalizedId = normalizeId(id);
    rarityMap.set(normalizedId, value ?? null);
  });
  Object.entries(payload.itemMap || {}).forEach(([id, value]) => {
    const normalizedId = normalizeId(id);
    if (value && typeof value === 'object') {
      itemMap.set(normalizedId, value);
    } else {
      itemMap.set(normalizedId, null);
    }
  });

  return { priceMap, iconMap, rarityMap, itemMap };
}

export default async function fetchAggregateBundle(ids = [], options = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return {
      priceMap: new Map(),
      iconMap: new Map(),
      rarityMap: new Map(),
      itemMap: new Map(),
      meta: null,
    };
  }

  const {
    iconCache,
    rarityCache,
    itemCache,
    fields,
    page,
    pageSize,
    signal,
  } = options || {};

  const config = getConfig();
  const baseUrl = config?.API_BASE_URL || '/api';
  const defaultLang = options.lang || config?.DEFAULT_LANG || 'es';

  const params = new URLSearchParams();
  const normalizedIds = ids
    .map((value) => normalizeId(value))
    .filter((value) => {
      if (value == null || value === '') {
        return false;
      }
      if (Number.isFinite(value)) {
        return value > 0;
      }
      const text = String(value).trim();
      return Boolean(text);
    });
  normalizedIds.forEach((id) => {
    params.append('ids[]', String(id));
  });
  if (normalizedIds.length > 0) {
    params.set('ids', normalizedIds.join(','));
  }
  params.set('lang', String(defaultLang));
  const normalizedFields = normalizeFields(fields);
  if (normalizedFields) {
    params.set('fields', normalizedFields);
  }
  if (page != null) {
    params.set('page', String(page));
  }
  if (pageSize != null) {
    params.set('pageSize', String(pageSize));
  }

  const requestUrl = `${joinApiPath(baseUrl, '/aggregate/bundle')}?${params.toString()}`;

  try {
    return await fetchAggregateFromApi({
      requestUrl,
      signal,
      fields,
      normalizedIds,
      iconCache,
      rarityCache,
      itemCache,
    });
  } catch (error) {
    if (error?.code === 'AGGREGATE_INCOMPLETE') {
      throw error;
    }

    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[aggregateBundle] API fallback for aggregate bundle', error);
    }

    const fallbackPayload = await buildLegacyAggregatePayload(normalizedIds, {
      lang: defaultLang,
    });
    const maps = convertLegacyPayloadToMaps(fallbackPayload);
    emitCacheMetric('miss');
    return {
      ...maps,
      meta: fallbackPayload.meta,
    };
  }
}
