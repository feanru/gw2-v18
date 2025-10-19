import fetchWithRetry from '../utils/fetchWithRetry.js';
import { buildLegacyAggregatePayload } from '../utils/fetchAggregateBundle.js';
import { getConfig } from '../config.js';

const DEFAULT_TTL = 2 * 60 * 1000; // 2 minutos
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_FIELDS = ['priceMap', 'iconMap', 'rarityMap', 'itemMap'];

const aggregateState = {
  items: new Map(),
  prices: new Map(),
  meta: null,
  warnings: [],
  errors: [],
  expiresAt: 0,
};

function normalizeId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeItemEntry(id, value, iconMap, rarityMap) {
  const numericId = normalizeId(id);
  if (!numericId) return null;
  const base = value && typeof value === 'object' ? value : {};
  const iconFromMap = iconMap?.get(numericId) ?? null;
  const rarityFromMap = rarityMap?.get(numericId) ?? null;
  return {
    id: numericId,
    name: typeof base.name === 'string' ? base.name : null,
    icon: base.icon ?? iconFromMap?.icon ?? null,
    rarity: base.rarity ?? rarityFromMap?.rarity ?? null,
    type: typeof base.type === 'string' ? base.type : null,
  };
}

function normalizePriceEntry(id, value) {
  const numericId = normalizeId(id);
  if (!numericId) return null;
  const entry = value && typeof value === 'object' ? value : {};
  const normalizeNumber = (input) => {
    if (input == null) return null;
    const num = Number(input);
    return Number.isFinite(num) && num >= 0 ? num : null;
  };
  const buy = normalizeNumber(entry.buy_price ?? entry.buyPrice ?? entry.buy);
  const sell = normalizeNumber(entry.sell_price ?? entry.sellPrice ?? entry.sell);
  if (buy == null && sell == null) {
    return { id: numericId, buy_price: null, sell_price: null };
  }
  return { id: numericId, buy_price: buy, sell_price: sell };
}

function objectToMap(source, transform) {
  const map = new Map();
  if (!source || typeof source !== 'object') return map;
  Object.entries(source).forEach(([key, value]) => {
    const normalized = transform(key, value);
    if (normalized) {
      map.set(normalized.id, normalized);
    }
  });
  return map;
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

async function requestAggregate(ids, options = {}) {
  const config = getConfig();
  const baseUrl = config?.API_BASE_URL || '/api';
  const lang = options.lang || config?.DEFAULT_LANG || 'es';

  const params = new URLSearchParams();
  ids.forEach((id) => {
    params.append('ids[]', String(id));
  });
  if (ids.length > 0) {
    params.set('ids', ids.join(','));
  }
  params.set('lang', String(lang));
  if (Array.isArray(options.fields) && options.fields.length > 0) {
    params.set('fields', options.fields.join(','));
  }
  if (Number.isFinite(Number(options.page)) && Number(options.page) > 0) {
    params.set('page', Math.floor(Number(options.page)));
  }
  if (Number.isFinite(Number(options.pageSize)) && Number(options.pageSize) > 0) {
    params.set('pageSize', Math.floor(Number(options.pageSize)));
  }
  const requestUrl = `${joinApiPath(baseUrl, '/aggregate/bundle')}?${params.toString()}`;
  try {
    const response = await fetchWithRetry(requestUrl, {
      signal: options.signal,
      headers: {
        Accept: 'application/json, text/plain;q=0.9',
      },
    });
    if (!response.ok) {
      const error = new Error(`Error ${response.status} al consultar el agregado de bundle`);
      error.code = 'AGGREGATE_HTTP_ERROR';
      throw error;
    }
    const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
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
    return payload;
  } catch (error) {
    if (options.signal?.aborted || error?.name === 'AbortError') {
      throw error;
    }
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[donesAggregate] API fallback for aggregate bundle', error);
    }
    return buildLegacyAggregatePayload(ids, { lang, includePagination: true });
  }
}

export async function fetchDonesAggregate(rawIds = [], options = {}) {
  const ids = Array.from(new Set((Array.isArray(rawIds) ? rawIds : [rawIds])
    .map((value) => normalizeId(value))
    .filter((value) => Number.isFinite(value) && value > 0)));

  const ttl = Number.isFinite(Number(options.ttl)) && Number(options.ttl) > 0
    ? Number(options.ttl)
    : DEFAULT_TTL;
  const now = Date.now();
  const skipCache = options.skipCache === true;

  const cachedItems = new Map();
  const cachedPrices = new Map();
  ids.forEach((id) => {
    if (aggregateState.items.has(id)) {
      cachedItems.set(id, aggregateState.items.get(id));
    }
    if (aggregateState.prices.has(id)) {
      cachedPrices.set(id, aggregateState.prices.get(id));
    }
  });

  const cacheExpired = skipCache || now >= aggregateState.expiresAt;
  const missingFromCache = cacheExpired
    ? ids
    : ids.filter((id) => !cachedItems.has(id) || !cachedPrices.has(id));

  if (!skipCache && !cacheExpired && missingFromCache.length === 0) {
    return {
      ok: true,
      partial: false,
      fromCache: true,
      itemsMap: cachedItems,
      pricesMap: cachedPrices,
      meta: aggregateState.meta,
      warnings: Array.isArray(aggregateState.warnings) ? [...aggregateState.warnings] : [],
      errors: Array.isArray(aggregateState.errors) ? [...aggregateState.errors] : [],
      missingIds: [],
    };
  }

  if (ids.length === 0) {
    return {
      ok: true,
      partial: false,
      fromCache: true,
      itemsMap: new Map(),
      pricesMap: new Map(),
      meta: aggregateState.meta,
      warnings: Array.isArray(aggregateState.warnings) ? [...aggregateState.warnings] : [],
      errors: Array.isArray(aggregateState.errors) ? [...aggregateState.errors] : [],
      missingIds: [],
    };
  }

  const idsToFetch = cacheExpired ? ids : missingFromCache;
  const requestedFields = Array.isArray(options.fields) && options.fields.length > 0
    ? options.fields
    : DEFAULT_FIELDS;
  const pageSize = Number.isFinite(Number(options.pageSize)) && Number(options.pageSize) > 0
    ? Math.floor(Number(options.pageSize))
    : DEFAULT_PAGE_SIZE;

  const collectedPayloads = [];
  let currentPage = 1;
  let totalPages = 1;
  do {
    const payload = await requestAggregate(idsToFetch, {
      signal: options.signal,
      page: currentPage,
      pageSize,
      fields: requestedFields,
    });
    collectedPayloads.push(payload);
    const pagination = payload?.meta?.pagination || null;
    if (pagination && Number.isFinite(Number(pagination.totalPages))) {
      totalPages = Math.max(1, Number(pagination.totalPages));
    }
    if (!pagination || !pagination.hasNext) {
      break;
    }
    const nextPage = Number.isFinite(Number(pagination.page))
      ? Number(pagination.page) + 1
      : currentPage + 1;
    if (nextPage <= currentPage || nextPage > totalPages) {
      break;
    }
    currentPage = nextPage;
  } while (currentPage <= totalPages);

  const combinedPriceMap = {};
  const combinedIconMap = {};
  const combinedRarityMap = {};
  const combinedItemMap = {};
  const combinedErrors = [];
  const combinedWarnings = new Set();
  let latestMeta = null;

  collectedPayloads.forEach((payload) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    if (payload.priceMap && typeof payload.priceMap === 'object') {
      Object.assign(combinedPriceMap, payload.priceMap);
    }
    if (payload.iconMap && typeof payload.iconMap === 'object') {
      Object.assign(combinedIconMap, payload.iconMap);
    }
    if (payload.rarityMap && typeof payload.rarityMap === 'object') {
      Object.assign(combinedRarityMap, payload.rarityMap);
    }
    if (payload.itemMap && typeof payload.itemMap === 'object') {
      Object.assign(combinedItemMap, payload.itemMap);
    }
    if (Array.isArray(payload.errors)) {
      payload.errors.forEach((entry) => combinedErrors.push(entry));
    } else if (payload.errors) {
      combinedErrors.push(payload.errors);
    }
    const meta = payload.meta || null;
    if (meta) {
      latestMeta = meta;
      if (Array.isArray(meta.warnings)) {
        meta.warnings.filter(Boolean).forEach((warning) => combinedWarnings.add(warning));
      }
    }
  });

  const payload = {
    priceMap: combinedPriceMap,
    iconMap: combinedIconMap,
    rarityMap: combinedRarityMap,
    itemMap: combinedItemMap,
    meta: latestMeta || null,
    errors: combinedErrors,
  };
  if (payload.meta && combinedWarnings.size > 0) {
    payload.meta = { ...payload.meta, warnings: Array.from(combinedWarnings) };
  }

  const iconMap = objectToMap(payload.iconMap, (key, value) => {
    const id = normalizeId(key);
    if (!id) return null;
    return { id, icon: value ?? null };
  });
  const rarityMap = objectToMap(payload.rarityMap, (key, value) => {
    const id = normalizeId(key);
    if (!id) return null;
    return { id, rarity: value ?? null };
  });

  const incomingItems = objectToMap(payload.itemMap, (key, value) => normalizeItemEntry(key, value, iconMap, rarityMap));
  if (incomingItems.size === 0) {
    idsToFetch.forEach((id) => {
      const iconEntry = iconMap.get(id) ?? null;
      const rarityEntry = rarityMap.get(id) ?? null;
      if (!iconEntry && !rarityEntry) return;
      incomingItems.set(id, {
        id,
        name: null,
        icon: iconEntry?.icon ?? null,
        rarity: rarityEntry?.rarity ?? null,
        type: null,
      });
    });
  }

  const incomingPrices = objectToMap(payload.priceMap, (key, value) => normalizePriceEntry(key, value));

  if (cacheExpired) {
    idsToFetch.forEach((id) => {
      aggregateState.items.delete(id);
      aggregateState.prices.delete(id);
    });
  }

  const combinedItems = cacheExpired ? new Map() : new Map(cachedItems);
  incomingItems.forEach((value, id) => {
    combinedItems.set(id, value);
    aggregateState.items.set(id, value);
  });

  const combinedPrices = cacheExpired ? new Map() : new Map(cachedPrices);
  incomingPrices.forEach((value, id) => {
    combinedPrices.set(id, value);
    aggregateState.prices.set(id, value);
  });

  const meta = payload.meta || null;
  const warnings = Array.isArray(meta?.warnings) ? [...meta.warnings] : [];
  const errors = [];
  if (Array.isArray(payload.errors)) {
    errors.push(...payload.errors);
  } else if (payload.errors) {
    errors.push(payload.errors);
  }

  aggregateState.meta = meta;
  aggregateState.warnings = warnings;
  aggregateState.errors = errors;
  aggregateState.expiresAt = now + ttl;

  const freshMissingIds = idsToFetch.filter((id) => !incomingItems.has(id) || !incomingPrices.has(id));
  const missingIds = Array.from(new Set([
    ...freshMissingIds,
    ...ids.filter((id) => !combinedItems.has(id) || !combinedPrices.has(id)),
  ]));

  return {
    ok: missingIds.length === 0 && errors.length === 0,
    partial: missingIds.length > 0 || errors.length > 0,
    fromCache: false,
    itemsMap: combinedItems,
    pricesMap: combinedPrices,
    meta,
    warnings,
    errors,
    missingIds,
  };
}

export function __resetDonesAggregateCacheForTests() {
  aggregateState.items.clear();
  aggregateState.prices.clear();
  aggregateState.meta = null;
  aggregateState.warnings = [];
  aggregateState.errors = [];
  aggregateState.expiresAt = 0;
}
