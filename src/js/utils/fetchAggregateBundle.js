import fetchWithRetry from './fetchWithRetry.js';

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

  const params = new URLSearchParams({ ids: ids.join(','), lang: 'es' });
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

  const response = await fetchWithRetry(`/api/aggregate/bundle?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Error ${response.status} al consultar el agregado de bundle`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Respuesta no válida del agregado de bundle');
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Datos no válidos del agregado de bundle');
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

  const normalizedIds = ids.map(normalizeId);
  const hasErrors = Array.isArray(payload.errors)
    ? payload.errors.length > 0
    : Boolean(payload.errors);
  const fieldSet = toFieldSet(fields);
  const expectPriceMap = !fieldSet || fieldSet.has('priceMap');
  const expectIconMap = !fieldSet || fieldSet.has('iconMap');
  const expectRarityMap = !fieldSet || fieldSet.has('rarityMap');
  const expectItemMap = fieldSet ? fieldSet.has('itemMap') : false;

  const missingIds = normalizedIds.filter((id) => {
    if (expectPriceMap && !priceMap.has(id)) return true;
    if (expectIconMap && !iconMap.has(id)) return true;
    if (expectRarityMap && !rarityMap.has(id)) return true;
    if (expectItemMap && !itemMap.has(id)) return true;
    return false;
  });

  if (hasErrors || missingIds.length > 0) {
    throw new Error('Datos incompletos del agregado de bundle');
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
