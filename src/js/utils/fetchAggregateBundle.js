import fetchWithRetry from './fetchWithRetry.js';

function normalizeId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

export default async function fetchAggregateBundle(ids = [], caches = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return {
      priceMap: new Map(),
      iconMap: new Map(),
      rarityMap: new Map(),
      meta: null,
    };
  }

  const params = new URLSearchParams({ ids: ids.join(','), lang: 'es' });
  const response = await fetchWithRetry(`/api/aggregate/bundle?${params.toString()}`);
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

  const priceMap = new Map();
  const iconMap = new Map();
  const rarityMap = new Map();

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
      if (value) {
        const normalizedId = normalizeId(id);
        iconMap.set(normalizedId, value);
        if (caches.iconCache && typeof caches.iconCache === 'object') {
          caches.iconCache[normalizedId] = value;
        }
      }
    });
  }

  if (payload.rarityMap && typeof payload.rarityMap === 'object') {
    Object.entries(payload.rarityMap).forEach(([id, value]) => {
      if (value) {
        const normalizedId = normalizeId(id);
        rarityMap.set(normalizedId, value);
        if (caches.rarityCache && typeof caches.rarityCache === 'object') {
          caches.rarityCache[normalizedId] = value;
        }
      }
    });
  }

  const normalizedIds = ids.map(normalizeId);
  const hasErrors = Array.isArray(payload.errors)
    ? payload.errors.length > 0
    : Boolean(payload.errors);
  const missingIds = normalizedIds.filter(
    id => !priceMap.has(id) || !iconMap.has(id) || !rarityMap.has(id),
  );
  if (hasErrors || missingIds.length > 0) {
    throw new Error('Datos incompletos del agregado de bundle');
  }

  return {
    priceMap,
    iconMap,
    rarityMap,
    meta: payload.meta || null,
  };
}
