'use strict';

const aggregateModule = require('../aggregates/buildItemAggregate');

const { DEFAULT_LANG } = aggregateModule;

const AGGREGATE_ALLOWED_FIELDS = new Set(['item', 'totals', 'tree', 'market']);
const AGGREGATE_DEFAULT_FIELDS = new Set(['item', 'totals', 'tree']);
const BUNDLE_ALLOWED_FIELDS = new Set(['priceMap', 'iconMap', 'rarityMap', 'itemMap']);
const BUNDLE_DEFAULT_FIELDS = new Set(['priceMap', 'iconMap', 'rarityMap']);

function parseFields(raw, allowed, fallback) {
  if (!allowed || allowed.size === 0) {
    return new Set();
  }
  if (typeof raw !== 'string') {
    return new Set(fallback || allowed);
  }
  const fields = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && allowed.has(value));
  if (fields.length === 0) {
    return new Set(fallback || allowed);
  }
  return new Set(fields);
}

function parseAggregateFields(raw) {
  return parseFields(raw, AGGREGATE_ALLOWED_FIELDS, AGGREGATE_DEFAULT_FIELDS);
}

function parseBundleFields(raw) {
  return parseFields(raw, BUNDLE_ALLOWED_FIELDS, BUNDLE_DEFAULT_FIELDS);
}

function filterAggregateData(data, fieldsSet) {
  const source = data && typeof data === 'object' ? data : {};
  const fields = fieldsSet && fieldsSet.size > 0 ? fieldsSet : AGGREGATE_ALLOWED_FIELDS;
  const result = {};
  fields.forEach((field) => {
    if (!AGGREGATE_ALLOWED_FIELDS.has(field)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
  });

  // Ensure backwards compatibility for totals/market consumers
  if (!result.totals && source.totals && fields.has('totals')) {
    result.totals = source.totals;
  }
  if (!result.market && source.market && fields.has('market')) {
    result.market = source.market;
  }

  return result;
}

function filterAggregateBundlePayload(payload, fieldsSet) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const fields = fieldsSet && fieldsSet.size > 0 ? fieldsSet : BUNDLE_ALLOWED_FIELDS;
  const result = { meta: source.meta || null };
  if (Array.isArray(source.errors) && source.errors.length > 0) {
    result.errors = [...source.errors];
  } else if (source.errors) {
    result.errors = source.errors;
  }

  fields.forEach((field) => {
    if (!BUNDLE_ALLOWED_FIELDS.has(field)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    } else if (!Object.prototype.hasOwnProperty.call(result, field)) {
      result[field] = {};
    }
  });

  return result;
}

function parsePositiveInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function paginateIds(ids, { page, pageSize } = {}) {
  const list = Array.isArray(ids) ? [...ids] : [];
  const totalIds = list.length;
  const size = parsePositiveInt(pageSize);
  if (!size || totalIds === 0) {
    return {
      ids: list,
      pagination: {
        page: totalIds === 0 ? 0 : 1,
        pageSize: size || null,
        totalIds,
        totalPages: totalIds === 0 ? 0 : 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  const totalPages = Math.max(1, Math.ceil(totalIds / size));
  const requestedPage = parsePositiveInt(page) || 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const start = (currentPage - 1) * size;
  const end = start + size;
  const slice = list.slice(start, end);

  return {
    ids: slice,
    pagination: {
      page: currentPage,
      pageSize: size,
      totalIds,
      totalPages,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
    },
  };
}

function normalizeIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  const normalized = [];
  for (const value of ids) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    normalized.push(parsed);
  }
  if (normalized.length === 0) {
    return [];
  }
  const unique = Array.from(new Set(normalized));
  unique.sort((a, b) => a - b);
  return unique;
}

function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function normalizeNumber(value) {
  if (value == null) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function resolveAggregateEntries(ids, {
  lang = DEFAULT_LANG,
  getCachedAggregate = aggregateModule.getCachedAggregate,
  buildItemAggregate = aggregateModule.buildItemAggregate,
  logger = console,
} = {}) {
  const normalizedIds = normalizeIds(ids);
  if (normalizedIds.length === 0) {
    return {
      ids: [],
      entries: new Map(),
      warnings: [],
      errors: [],
      stale: false,
      snapshot: null,
      resolved: true,
    };
  }

  const aggregateEntries = new Map();
  const aggregateErrors = [];
  const aggregateWarnings = [];
  let aggregateStale = false;
  let aggregateSnapshot = null;
  const missingFromCache = [];

  const cacheResults = await Promise.all(
    normalizedIds.map(async (itemId) => {
      try {
        const cached = await getCachedAggregate(itemId, lang);
        return { itemId, payload: cached };
      } catch (err) {
        if (process.env.NODE_ENV !== 'test' && logger && typeof logger.warn === 'function') {
          logger.warn(
            `[aggregate] aggregate cache lookup failed for ${itemId}/${lang}: ${err.message}`,
          );
        }
        return { itemId, payload: null };
      }
    }),
  );

  for (const { itemId, payload } of cacheResults) {
    if (payload && payload.data) {
      aggregateEntries.set(itemId, payload);
      aggregateStale = aggregateStale || Boolean(payload.meta?.stale);
      if (Array.isArray(payload.meta?.errors)) {
        aggregateErrors.push(...payload.meta.errors);
      }
      if (Array.isArray(payload.meta?.warnings)) {
        aggregateWarnings.push(...payload.meta.warnings);
      }
      const snapshotCandidate = payload.meta?.snapshotAt ?? payload.meta?.generatedAt ?? null;
      const snapshotDate = toDate(snapshotCandidate);
      if (snapshotDate) {
        if (!aggregateSnapshot || snapshotDate > aggregateSnapshot) {
          aggregateSnapshot = snapshotDate;
        }
      }
    } else {
      missingFromCache.push(itemId);
    }
  }

  if (missingFromCache.length > 0) {
    const buildResults = await Promise.all(
      missingFromCache.map(async (itemId) => {
        try {
          const built = await buildItemAggregate(itemId, lang);
          return { itemId, payload: built };
        } catch (err) {
          if (process.env.NODE_ENV !== 'test' && logger && typeof logger.warn === 'function') {
            logger.warn(
              `[aggregate] aggregate build failed for bundle ${itemId}/${lang}: ${err.message}`,
            );
          }
          return { itemId, error: err };
        }
      }),
    );

    for (const { itemId, payload, error } of buildResults) {
      if (payload && payload.data) {
        aggregateEntries.set(itemId, payload);
        aggregateStale = aggregateStale || Boolean(payload.meta?.stale);
        if (Array.isArray(payload.meta?.errors)) {
          aggregateErrors.push(...payload.meta.errors);
        }
        if (Array.isArray(payload.meta?.warnings)) {
          aggregateWarnings.push(...payload.meta.warnings);
        }
        const snapshotCandidate = payload.meta?.snapshotAt ?? payload.meta?.generatedAt ?? null;
        const snapshotDate = toDate(snapshotCandidate);
        if (snapshotDate) {
          if (!aggregateSnapshot || snapshotDate > aggregateSnapshot) {
            aggregateSnapshot = snapshotDate;
          }
        }
      } else if (error) {
        aggregateErrors.push({ code: 'aggregate_build_failed', msg: error.message });
      }
    }
  }

  return {
    ids: normalizedIds,
    entries: aggregateEntries,
    warnings: aggregateWarnings,
    errors: aggregateErrors,
    stale: aggregateStale,
    snapshot: aggregateSnapshot,
    resolved: aggregateEntries.size === normalizedIds.length,
  };
}

function buildBundleFromEntries(ids, entries) {
  const items = {};
  const market = {};

  for (const itemId of ids) {
    const entry = entries.get(itemId);
    const itemData = entry?.data?.item ?? null;
    items[itemId] = itemData || null;

    const totals = entry?.data?.totals ?? null;
    if (totals) {
      market[itemId] = {
        id: itemId,
        buy_price: normalizeNumber(totals.unitBuyPrice),
        sell_price: normalizeNumber(totals.unitSellPrice),
      };
    } else {
      market[itemId] = { id: itemId, buy_price: null, sell_price: null };
    }
  }

  return { items, market };
}

function buildMapsFromEntries(ids, entries) {
  const priceMap = {};
  const iconMap = {};
  const rarityMap = {};

  for (const itemId of ids) {
    const entry = entries.get(itemId);
    const itemData = entry?.data?.item ?? null;
    const totals = entry?.data?.totals ?? null;

    iconMap[itemId] = itemData?.icon ?? null;
    rarityMap[itemId] = itemData?.rarity ?? null;

    if (totals) {
      priceMap[itemId] = {
        id: itemId,
        buy_price: normalizeNumber(totals.unitBuyPrice),
        sell_price: normalizeNumber(totals.unitSellPrice),
      };
    } else {
      priceMap[itemId] = { id: itemId, buy_price: null, sell_price: null };
    }
  }

  return { priceMap, iconMap, rarityMap };
}

function buildAggregateMeta({
  lang = DEFAULT_LANG,
  source = 'aggregate',
  stale = false,
  warnings = [],
  errors = [],
  snapshot = null,
} = {}) {
  const warningsSet = new Set();
  for (const entry of warnings || []) {
    if (entry == null) {
      continue;
    }
    const normalized = String(entry);
    if (!normalized) {
      continue;
    }
    warningsSet.add(normalized);
  }

  const normalizedErrors = [];
  for (const entry of errors || []) {
    if (entry == null) {
      continue;
    }
    normalizedErrors.push(entry);
  }

  let snapshotIso = null;
  const snapshotDate = toDate(snapshot);
  if (snapshotDate) {
    snapshotIso = snapshotDate.toISOString();
  }

  const meta = {
    lang,
    source,
    stale: Boolean(stale),
    snapshotAt: snapshotIso,
    warnings: Array.from(warningsSet),
  };

  return { meta, errors: normalizedErrors };
}

function createEntriesFromBundleData(ids, bundleData = {}) {
  const entries = new Map();

  if (Array.isArray(bundleData)) {
    for (const entry of bundleData) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const itemId = Number(entry.id);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        continue;
      }
      const marketEntry = entry.market || null;
      let totals = null;
      if (marketEntry && (marketEntry.buy_price != null || marketEntry.sell_price != null)) {
        totals = {
          unitBuyPrice: normalizeNumber(marketEntry.buy_price),
          unitSellPrice: normalizeNumber(marketEntry.sell_price),
        };
      }
      entries.set(itemId, {
        data: {
          item: entry.item || null,
          totals,
        },
        meta: entry.meta || {},
      });
    }
  } else {
    const items = bundleData.items || {};
    const market = bundleData.market || {};

    for (const itemId of ids) {
      const item = items[itemId] ?? items[String(itemId)] ?? null;
      const marketEntry = market[itemId] ?? market[String(itemId)] ?? null;
      let totals = null;
      if (marketEntry && (marketEntry.buy_price != null || marketEntry.sell_price != null)) {
        totals = {
          unitBuyPrice: normalizeNumber(marketEntry.buy_price),
          unitSellPrice: normalizeNumber(marketEntry.sell_price),
        };
      }
      entries.set(itemId, {
        data: {
          item: item || null,
          totals,
        },
        meta: bundleData.meta || {},
      });
    }
  }

  for (const itemId of ids) {
    if (!entries.has(itemId)) {
      entries.set(itemId, {
        data: {
          item: null,
          totals: null,
        },
        meta: {},
      });
    }
  }

  return entries;
}

module.exports = {
  DEFAULT_LANG,
  normalizeIds,
  resolveAggregateEntries,
  buildBundleFromEntries,
  buildMapsFromEntries,
  buildAggregateMeta,
  createEntriesFromBundleData,
  parseAggregateFields,
  parseBundleFields,
  filterAggregateData,
  filterAggregateBundlePayload,
  paginateIds,
};
