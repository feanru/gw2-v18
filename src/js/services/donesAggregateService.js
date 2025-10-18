import fetchWithRetry from '../utils/fetchWithRetry.js';

const DEFAULT_TTL = 2 * 60 * 1000; // 2 minutos

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

async function requestAggregate(ids, options = {}) {
  const params = new URLSearchParams();
  params.set('ids', ids.join(','));
  params.set('lang', 'es');
  const response = await fetchWithRetry(`/api/aggregate/bundle?${params.toString()}`, {
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Error ${response.status} al consultar el agregado de bundle`);
  }
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  if (!String(contentType).toLowerCase().includes('application/json')) {
    throw new Error('Respuesta no válida del agregado de bundle');
  }
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Datos no válidos del agregado de bundle');
  }
  return payload;
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
  const payload = await requestAggregate(idsToFetch, options);

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
