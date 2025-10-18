import { showSkeleton, hideSkeleton } from './ui-helpers.js';
import { restoreCraftIngredientPrototypes } from './items-core.js';
import { runCostsWorkerTask } from './workers/costsWorkerClient.js';
import { getCached, setCached } from './utils/cache.js';
import { preloadPrices } from './utils/priceHelper.js';
import { fetchDonesAggregate } from './services/donesAggregateService.js';
import { isFeatureEnabled } from './utils/featureFlags.js';
import { trackTelemetryEvent } from './utils/telemetry.js';
// js/dones.js

// Sección de "Dones Especiales" (ejemplo: Don de la Suerte)
// Puedes agregar más dones en el array DONES si lo deseas

var DONES = [
  {
    id: 19673, // ID real para Don de la Magia
    name: "Don de la Magia",
    mainIngredients: [
      { id: 19675, name: "Trébol místico", type: "account_bound", count: 77, components: [
  { id: 19976, name: "Moneda mística", count: 250 },
  { id: 19721, name: "Pegote de ectoplasma", count: 250 },
  { id: 19925, name: "Esquirla de obsidiana", count: 250 },
  { id: 20796, name: "Piedra filosofal", count: 1500 }
]},
      { id: 19721, name: "Pegote de ectoplasma", count: 250 }
    ],
    manualIngredients: [
      { id: 24295, name: "Vial de sangre poderosa", count: 250 },
      { id: 24283, name: "Vesícula de veneno poderoso", count: 250 },
      { id: 24300, name: "Tótem elaborado", count: 250 },
      { id: 24277, name: "Montón de polvo cristalino", count: 250 },
    ]
  },
  {
    id: 19672, // ID real para Don del Poder
    name: "Don del Poder",
    manualIngredients: [
      { id: 24357, name: "Colmillo feroz", count: 250 },
      { id: 24289, name: "Escama blindada", count: 250 },
      { id: 24351, name: "Garra despiadada", count: 250 },
      { id: 24358, name: "Hueso antiguo", count: 250 },
    ]
  },
  {
    id: 19626,
    name: "Don de la Suerte",
    mainIngredients: [
      { id: 19721, name: "Pegote de ectoplasma", count: 250 },
      {
        id: 19675,
        name: "Trébol místico",
        type: "account_bound",
        count: 77,
        components: [
          { id: 19976, name: "Moneda mística", count: 250 },
          { id: 19721, name: "Pegote de ectoplasma", count: 250 },
          { id: 19925, name: "Esquirla de obsidiana", count: 250 },
          { id: 20796, name: "Piedra filosofal", count: 1500 }
        ]
      },
      {
        id: 19673,
        name: "Don de la Magia",
        type: "crafting_material",
        count: 1,
        components: [
          { id: 24295, name: "Vial de sangre poderosa", count: 250 },
          { id: 24283, name: "Vesícula de veneno poderoso", count: 250 },
          { id: 24300, name: "Tótem elaborado", count: 250 },
          { id: 24277, name: "Montón de polvo cristalino", count: 250 }
        ]
      },
      {
        id: 19672,
        name: "Don del Poder",
        type: "crafting_material",
        count: 1,
        components: [
          { id: 24351, name: "Colmillo feroz", count: 250 },
          { id: 24289, name: "Escama blindada", count: 250 },
          { id: 24357, name: "Garra despiadada", count: 250 },
          { id: 24358, name: "Hueso antiguo", count: 250 }
        ]
      }
    ]
  }
];

const donesContent = document.getElementById('dones-content');
const donesSkeleton = document.getElementById('dones-skeleton');
const errorMsg = document.getElementById('error-message');

window.showSkeleton = showSkeleton;
window.hideSkeleton = hideSkeleton;


// --- Fin de formatGold ---

// IDs de ítems no comerciables o con precios especiales que deben saltarse
// Items con precio fijo manual
const FIXED_PRICE_ITEMS = {
  19676: 10000 // Piedra rúnica helada: 1 oro (10000 cobre)
};

const NO_MARKET_TEXT = 'sin precio';
const NO_MARKET_LABEL = `${NO_MARKET_TEXT} (fuera del mercado)`;
const NO_MARKET_ACCOUNT_LABEL = `${NO_MARKET_TEXT} (vinculado a cuenta)`;

const BASE_NON_MARKET_ITEMS = new Map([
  [19675, 'account'], // Trébol místico (vinculado a cuenta)
  [19925, 'market'], // Esquirla de obsidiana (precio especial)
  [20796, 'market'], // Piedra filosofal (precio especial)
  [19633, 'market'], // Componentes sin valor de mercado
  [19634, 'market'],
  [19641, 'market'],
  [19642, 'market'],
  [19628, 'market'],
  [20799, 'account'] // Cristal místico (no comerciable)
]);

const defaultGiftNameChecker = (name = '') => {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.startsWith('don de ') || lower.startsWith('don del ') || lower.startsWith('don de la ');
};

const getGiftNameChecker = () => {
  const { isGiftName } = window?.DonesCore || {};
  return typeof isGiftName === 'function' ? isGiftName : defaultGiftNameChecker;
};

const isLegendaryGiftLike = (name) => {
  if (typeof name !== 'string' || !name) return false;
  const checker = getGiftNameChecker();
  if (checker(name)) return true;
  const lower = name.toLowerCase();
  return lower.includes('tributo') || lower.includes('bendición');
};

let cachedNonMarketMap = null;
let legendaryDataProcessed = false;

const ITEM_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const PRELOAD_REFRESH_TTL = 6 * 60 * 60 * 1000; // 6 horas

const sharedPreloadState = {
  promise: null,
  expiresAt: 0,
  payload: {
    items: new Map(),
    prices: new Map(),
  },
  pendingExtraIds: new Set(),
};

let legendaryLookupMap = null;

function recordDonesAggregateFallback(reason, meta = null, error = null, extra = {}) {
  if (typeof window === 'undefined' || !window) {
    return null;
  }

  if (!Array.isArray(window.__donesAggregateFallbacks__)) {
    window.__donesAggregateFallbacks__ = [];
  }

  const rawIds = Array.isArray(extra?.ids) ? extra.ids : [];
  const ids = rawIds
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const errors = Array.isArray(extra?.errors)
    ? extra.errors.map((entry) => (typeof entry === 'string' ? entry : String(entry || '')))
    : undefined;
  const event = {
    reason: reason || 'unknown',
    meta: meta ? { ...meta } : null,
    stale: Boolean(meta?.stale),
    ids,
    errors,
    error: error ? String(error?.message || error) : undefined,
    timestamp: new Date().toISOString(),
  };

  window.__donesAggregateFallbacks__.push(event);
  if (window.__donesAggregateFallbacks__.length > 50) {
    window.__donesAggregateFallbacks__.shift();
  }
  window.__lastDonesAggregateFallback__ = event;

  try {
    trackTelemetryEvent?.({
      type: 'donesAggregateFallback',
      meta: {
        reason: event.reason,
        stale: event.stale,
        missing: ids.length,
      },
      error: event.error,
    });
  } catch (telemetryError) {
    console.warn('No se pudo registrar telemetría de fallback de dones', telemetryError);
  }

  return event;
}

function buildLegendaryLookup() {
  legendaryLookupMap = new Map();
  const legendaryData = window.LegendaryData;
  if (!legendaryData) return;

  const visited = new Set();
  const traverse = (node) => {
    if (!node || visited.has(node)) return;
    visited.add(node);
    const numericId = Number(node.id);
    if (Number.isFinite(numericId) && !legendaryLookupMap.has(numericId)) {
      legendaryLookupMap.set(numericId, {
        id: numericId,
        name: node.name || null,
        icon: node.icon || null,
        rarity: node.rarity || null,
        type: node.type || null,
      });
    }
    if (Array.isArray(node.components)) {
      node.components.forEach(traverse);
    }
  };

  const processCollection = (collection) => {
    if (!collection) return;
    Object.values(collection).forEach((entry) => traverse(entry));
  };

  processCollection(legendaryData.LEGENDARY_ITEMS);
  processCollection(legendaryData.LEGENDARY_ITEMS_3GEN);
}

function getLegendaryNodeById(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  if (!legendaryLookupMap) {
    buildLegendaryLookup();
  }
  return legendaryLookupMap?.get(numericId) || null;
}

function collectIdsFromValue(value, targetSet = new Set()) {
  if (!value) return targetSet;
  if (!targetSet || !(targetSet instanceof Set)) {
    return collectIdsFromValue(value, new Set());
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectIdsFromValue(entry, targetSet));
    return targetSet;
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'id')) {
      const numericId = Number(value.id);
      if (Number.isFinite(numericId)) {
        targetSet.add(numericId);
      }
    }
    Object.values(value).forEach((child) => collectIdsFromValue(child, targetSet));
  }
  return targetSet;
}

function collectLegendaryGiftIds(targetSet) {
  const legendaryData = window.LegendaryData;
  if (!legendaryData) return;
  const seen = new Set();

  const processCollection = (collection) => {
    if (!collection) return;
    Object.values(collection).forEach((item) => {
      if (!item || !Array.isArray(item.components)) return;
      item.components.forEach((component) => {
        if (!component || !component.name) return;
        const lower = component.name.toLowerCase();
        if (!lower.startsWith('don de') || lower.includes('la suerte') || lower.includes('del dominio')) return;
        const numericId = Number(component.id);
        if (!Number.isFinite(numericId) || seen.has(numericId)) return;
        seen.add(numericId);
        collectIdsFromValue(component, targetSet);
      });
    });
  };

  processCollection(legendaryData.LEGENDARY_ITEMS);
}

function gatherBaseIngredientIds() {
  const ids = new Set();
  collectIdsFromValue(DONES, ids);
  collectIdsFromValue(TRIBUTO, ids);
  collectIdsFromValue(TRIBUTO_DRACONICO, ids);
  collectLegendaryGiftIds(ids);
  return ids;
}

function normalizeItemForCache(id, item = null) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  const legendary = getLegendaryNodeById(numericId);
  const fallbackName = item?.name ?? item?.localized_name ?? item?.display_name ?? null;
  const fallbackIcon = item?.icon ?? null;
  const normalized = {
    id: numericId,
    name: legendary?.name ?? fallbackName ?? null,
    icon: legendary?.icon ?? fallbackIcon ?? null,
    rarity: legendary?.rarity ?? item?.rarity ?? null,
    type: legendary?.type ?? item?.type ?? null,
  };
  if (
    normalized.name == null &&
    normalized.icon == null &&
    normalized.rarity == null &&
    normalized.type == null
  ) {
    return null;
  }
  return normalized;
}

function mapToPlainObject(map) {
  const result = {};
  if (!map || !(map instanceof Map)) return result;
  map.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function getPreloadedItemData(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  const payload = sharedPreloadState.payload;
  if (payload?.items instanceof Map && payload.items.has(numericId)) {
    return payload.items.get(numericId);
  }
  const cachedItem = getCached(`item_${numericId}`);
  if (cachedItem) {
    const normalized = normalizeItemForCache(numericId, cachedItem);
    if (normalized && payload?.items instanceof Map) {
      payload.items.set(numericId, normalized);
    }
    return normalized;
  }
  const legendary = normalizeItemForCache(numericId, null);
  if (legendary && payload?.items instanceof Map) {
    payload.items.set(numericId, legendary);
  }
  return legendary;
}

function getPreloadedPriceData(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  if (Object.prototype.hasOwnProperty.call(FIXED_PRICE_ITEMS, numericId)) {
    const fixed = FIXED_PRICE_ITEMS[numericId];
    return { buy_price: fixed, sell_price: fixed };
  }
  const payload = sharedPreloadState.payload;
  if (payload?.prices instanceof Map && payload.prices.has(numericId)) {
    return payload.prices.get(numericId);
  }
  return null;
}

function buildManualIngredientDisplay(ingredient) {
  if (!ingredient) {
    return {
      id: null,
      name: '',
      icon: '',
      count: 0,
      priceBuy: null,
      priceSell: null,
      marketStatus: { skip: true, label: NO_MARKET_LABEL },
    };
  }
  const numericId = Number(ingredient.id);
  const itemInfo = getPreloadedItemData(numericId);
  const name = itemInfo?.name || ingredient.name || '';
  const type = itemInfo?.type || ingredient.type;
  const icon = itemInfo?.icon || '';
  const marketStatus = resolveMarketStatus(ingredient.id, name, type);
  const priceInfo = marketStatus.skip ? null : getPreloadedPriceData(numericId);
  return {
    id: ingredient.id,
    name,
    icon,
    count: ingredient.count,
    priceBuy: marketStatus.skip ? null : priceInfo?.buy_price ?? null,
    priceSell: marketStatus.skip ? null : priceInfo?.sell_price ?? null,
    marketStatus,
  };
}

async function ensurePreloadedIngredientData(extraNodes = []) {
  const now = Date.now();
  const hasExtra = Array.isArray(extraNodes) && extraNodes.length > 0;
  const payload = sharedPreloadState.payload;
  const itemsMap = payload?.items instanceof Map ? payload.items : null;
  const pricesMap = payload?.prices instanceof Map ? payload.prices : null;
  const hasValidPayload = Boolean(itemsMap && pricesMap);
  const extraIds = hasExtra ? collectIdsFromValue(extraNodes, new Set()) : new Set();
  const missingExtraIds = new Set();

  if (extraIds.size > 0) {
    extraIds.forEach((rawId) => {
      const id = Number(rawId);
      if (!Number.isFinite(id)) return;
      if (!hasValidPayload || !itemsMap.has(id) || !pricesMap.has(id)) {
        missingExtraIds.add(id);
      }
    });
  }

  const ttlExpired = now >= sharedPreloadState.expiresAt;
  const needsRefresh = ttlExpired || !hasValidPayload || missingExtraIds.size > 0;

  if (!needsRefresh && payload) {
    return payload;
  }

  if (!(sharedPreloadState.pendingExtraIds instanceof Set)) {
    sharedPreloadState.pendingExtraIds = new Set();
  }

  if (extraIds.size > 0) {
    const idsToQueue = needsRefresh ? extraIds : missingExtraIds;
    idsToQueue.forEach((id) => {
      if (Number.isFinite(id)) {
        sharedPreloadState.pendingExtraIds.add(Number(id));
      }
    });
  }

  if (sharedPreloadState.promise) {
    return sharedPreloadState.promise.then(() => ensurePreloadedIngredientData(extraNodes));
  }

  sharedPreloadState.promise = (async () => {
    const ids = gatherBaseIngredientIds();
    if (sharedPreloadState.pendingExtraIds instanceof Set) {
      sharedPreloadState.pendingExtraIds.forEach((id) => ids.add(id));
      sharedPreloadState.pendingExtraIds.clear();
    }
    const idsArray = Array.from(ids);
    const service = window.RecipeService || {};
    const bundleMap = new Map();
    const ensureBundle = (id) => {
      if (!bundleMap.has(id)) {
        bundleMap.set(id, { id, item: null, market: null });
      }
      return bundleMap.get(id);
    };

    const aggregateEnabled = isFeatureEnabled('donesAggregate');
    const aggregateState = {
      meta: null,
      errors: [],
      warnings: [],
      missingIds: [],
      used: false,
      fromCache: false,
    };
    let aggregateError = null;

    if (aggregateEnabled) {
      try {
        const aggregate = await fetchDonesAggregate(idsArray);
        aggregateState.used = true;
        aggregateState.meta = aggregate?.meta || null;
        aggregateState.errors = Array.isArray(aggregate?.errors) ? [...aggregate.errors] : [];
        aggregateState.warnings = Array.isArray(aggregate?.warnings) ? [...aggregate.warnings] : [];
        aggregateState.missingIds = Array.isArray(aggregate?.missingIds)
          ? aggregate.missingIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value))
          : [];
        aggregateState.fromCache = Boolean(aggregate?.fromCache);

        if (aggregate?.itemsMap instanceof Map) {
          aggregate.itemsMap.forEach((item, id) => {
            const numericId = Number(id);
            if (!Number.isFinite(numericId)) return;
            const entry = ensureBundle(numericId);
            entry.item = item;
          });
        }

        if (aggregate?.pricesMap instanceof Map) {
          aggregate.pricesMap.forEach((price, id) => {
            const numericId = Number(id);
            if (!Number.isFinite(numericId)) return;
            const entry = ensureBundle(numericId);
            entry.market = {
              ...(entry.market || {}),
              buy_price: price?.buy_price ?? null,
              sell_price: price?.sell_price ?? null,
            };
          });
        }
      } catch (err) {
        aggregateError = err;
        console.error('Error al precargar datos del agregado de dones', err);
      }
    }

    if (aggregateEnabled && aggregateState.warnings.length && !aggregateState.fromCache) {
      console.warn('Advertencias del agregado de dones', aggregateState.warnings);
    }

    const nonMarketMap = getNonMarketMap();
    const idsNeedingLegacy = new Set();
    let fallbackReason = aggregateEnabled ? null : 'flag-disabled';

    if (!aggregateEnabled) {
      idsArray.forEach((rawId) => {
        const id = Number(rawId);
        if (Number.isFinite(id)) idsNeedingLegacy.add(id);
      });
    } else if (aggregateError) {
      fallbackReason = 'aggregate-error';
      idsArray.forEach((rawId) => {
        const id = Number(rawId);
        if (Number.isFinite(id)) idsNeedingLegacy.add(id);
      });
    } else {
      idsArray.forEach((rawId) => {
        const id = Number(rawId);
        if (!Number.isFinite(id)) return;
        const entry = bundleMap.get(id) || null;
        if (!entry?.item) {
          idsNeedingLegacy.add(id);
        }
        const skipPrice = Object.prototype.hasOwnProperty.call(FIXED_PRICE_ITEMS, id) || nonMarketMap.has(id);
        if (!skipPrice) {
          const market = entry?.market || null;
          const hasPrice = Boolean(
            market && (
              (market.buy_price != null && Number.isFinite(Number(market.buy_price))) ||
              (market.sell_price != null && Number.isFinite(Number(market.sell_price))) ||
              (market.buys?.unit_price != null) ||
              (market.sells?.unit_price != null)
            )
          );
          if (!hasPrice) {
            idsNeedingLegacy.add(id);
          }
        }
      });

      aggregateState.missingIds.forEach((id) => idsNeedingLegacy.add(id));

      if (idsNeedingLegacy.size > 0 && aggregateState.missingIds.length > 0) {
        fallbackReason = 'missing-data';
      }

      if (!fallbackReason && aggregateState.errors.length > 0) {
        fallbackReason = 'aggregate-errors';
      }
    }

    const legacyIds = Array.from(idsNeedingLegacy);
    if (legacyIds.length > 0) {
      const reason = fallbackReason || (aggregateError ? 'aggregate-error' : 'legacy-required');
      recordDonesAggregateFallback(reason, aggregateState.meta, aggregateError, {
        ids: legacyIds,
        errors: aggregateState.errors,
      });
    }

    if (legacyIds.length > 0) {
      if (typeof service.getItemBundles === 'function') {
        try {
          const bundles = await service.getItemBundles(legacyIds);
          legacyIds.forEach((rawId, index) => {
            const id = Number(rawId);
            if (!Number.isFinite(id)) return;
            const bundle = Array.isArray(bundles) ? bundles[index] : null;
            if (!bundle) return;
            const entry = ensureBundle(id);
            if (bundle.item) {
              entry.item = bundle.item;
            }
            if (bundle.market) {
              entry.market = entry.market
                ? { ...bundle.market, ...entry.market }
                : bundle.market;
            }
          });
        } catch (err) {
          console.error('Error al precargar bundles de dones', err);
        }
      } else {
        const [items = [], prices = []] = await Promise.all([
          typeof service.getItemDetails === 'function' ? service.getItemDetails(legacyIds) : Promise.resolve([]),
          typeof service.getItemPrices === 'function' ? service.getItemPrices(legacyIds) : Promise.resolve([]),
        ]).catch((err) => {
          console.error('Error al precargar datos de dones', err);
          return [[], []];
        });

        legacyIds.forEach((rawId, index) => {
          const id = Number(rawId);
          if (!Number.isFinite(id)) return;
          const item = Array.isArray(items) ? items[index] : null;
          const priceEntry = Array.isArray(prices) ? prices[index] : null;
          const market = priceEntry
            ? {
                buy_price: priceEntry?.buys?.unit_price ?? null,
                sell_price: priceEntry?.sells?.unit_price ?? null,
              }
            : null;
          const entry = ensureBundle(id);
          if (item) {
            entry.item = item;
          }
          if (market) {
            entry.market = entry.market
              ? { ...market, ...entry.market }
              : market;
          }
        });
      }
    }

    idsArray.forEach((rawId) => {
      const id = Number(rawId);
      if (!Number.isFinite(id)) return;
      ensureBundle(id);
    });

    const helperTargets = [];
    idsArray.forEach((rawId) => {
      const id = Number(rawId);
      if (!Number.isFinite(id)) return;
      const entry = bundleMap.get(id) || null;
      const skipPrice = Object.prototype.hasOwnProperty.call(FIXED_PRICE_ITEMS, id) || nonMarketMap.has(id);
      if (skipPrice) return;
      const market = entry?.market || null;
      const hasPrice = Boolean(
        market && (
          (market.buy_price != null && Number.isFinite(Number(market.buy_price))) ||
          (market.sell_price != null && Number.isFinite(Number(market.sell_price))) ||
          (market.buys?.unit_price != null) ||
          (market.sells?.unit_price != null)
        )
      );
      if (!hasPrice) {
        helperTargets.push(id);
      }
    });

    let helperPrices = new Map();
    if (helperTargets.length > 0) {
      try {
        helperPrices = await preloadPrices(helperTargets);
      } catch (err) {
        console.error('Error al precargar precios de dones', err);
        helperPrices = new Map();
      }
    }

    const itemsMap = new Map();
    const pricesMap = new Map();

    idsArray.forEach((rawId) => {
      const id = Number(rawId);
      if (!Number.isFinite(id)) return;
      const bundle = bundleMap.get(id) || null;
      const baseItem = bundle?.item || null;
      const normalizedItem = normalizeItemForCache(id, baseItem);
      if (normalizedItem) {
        itemsMap.set(id, normalizedItem);
        setCached(`item_${id}`, normalizedItem, ITEM_CACHE_TTL);
      } else {
        const cachedItem = getCached(`item_${id}`);
        if (cachedItem) {
          const normalizedCached = normalizeItemForCache(id, cachedItem);
          if (normalizedCached) {
            itemsMap.set(id, normalizedCached);
          }
        }
      }

      const helperPrice = helperPrices.get(id) || null;
      let buyPrice = helperPrice?.buy_price ?? null;
      let sellPrice = helperPrice?.sell_price ?? null;

      const market = bundle?.market || null;
      if (market) {
        if (buyPrice == null && market.buy_price != null) buyPrice = market.buy_price;
        if (buyPrice == null && market.buys?.unit_price != null) buyPrice = market.buys.unit_price;
        if (sellPrice == null && market.sell_price != null) sellPrice = market.sell_price;
        if (sellPrice == null && market.sells?.unit_price != null) sellPrice = market.sells.unit_price;
      }

      if (Object.prototype.hasOwnProperty.call(FIXED_PRICE_ITEMS, id)) {
        const fixed = FIXED_PRICE_ITEMS[id];
        buyPrice = fixed;
        sellPrice = fixed;
      }

      pricesMap.set(id, {
        buy_price: buyPrice != null ? buyPrice : null,
        sell_price: sellPrice != null ? sellPrice : null,
      });
    });

    idsArray.forEach((rawId) => {
      const id = Number(rawId);
      if (!Number.isFinite(id)) return;
      if (!itemsMap.has(id)) {
        const legendary = normalizeItemForCache(id, null);
        if (legendary) {
          itemsMap.set(id, legendary);
        }
      }
      if (!pricesMap.has(id)) {
        if (Object.prototype.hasOwnProperty.call(FIXED_PRICE_ITEMS, id)) {
          const fixed = FIXED_PRICE_ITEMS[id];
          pricesMap.set(id, { buy_price: fixed, sell_price: fixed });
        } else {
          pricesMap.set(id, { buy_price: null, sell_price: null });
        }
      }
    });

    sharedPreloadState.payload = {
      items: itemsMap,
      prices: pricesMap,
    };
    sharedPreloadState.expiresAt = now + PRELOAD_REFRESH_TTL;
    return sharedPreloadState.payload;
  })()
    .catch((err) => {
      console.error('Error general al precargar datos de dones', err);
      return sharedPreloadState.payload;
    })
    .finally(() => {
      sharedPreloadState.promise = null;
    });

  return sharedPreloadState.promise;
}

function ensureLegendaryGiftIds(targetMap) {
  const legendaryData = window.LegendaryData;
  if (!legendaryData) return false;
  const { LEGENDARY_ITEMS, LEGENDARY_ITEMS_3GEN } = legendaryData;
  if (!LEGENDARY_ITEMS && !LEGENDARY_ITEMS_3GEN) return false;

  const visited = new Set();
  const traverse = (node) => {
    if (!node) return;
    const numericId = Number(node.id);
    if (Number.isFinite(numericId)) {
      if (visited.has(numericId)) return;
      visited.add(numericId);
      if (isLegendaryGiftLike(node.name)) {
        targetMap.set(numericId, 'gift');
      }
    }
    if (Array.isArray(node.components)) {
      node.components.forEach(traverse);
    }
  };

  const processCollection = (collection) => {
    if (!collection) return;
    Object.values(collection).forEach(item => {
      if (item && Array.isArray(item.components)) {
        item.components.forEach(traverse);
      }
    });
  };

  processCollection(LEGENDARY_ITEMS);
  processCollection(LEGENDARY_ITEMS_3GEN);
  return true;
}

function getNonMarketMap() {
  if (!cachedNonMarketMap) {
    cachedNonMarketMap = new Map(BASE_NON_MARKET_ITEMS);
  }
  if (!legendaryDataProcessed) {
    legendaryDataProcessed = ensureLegendaryGiftIds(cachedNonMarketMap);
  }
  return cachedNonMarketMap;
}

function resolveMarketStatus(id, name, type) {
  const numericId = Number(id);
  const map = getNonMarketMap();

  if (!Number.isFinite(numericId)) {
    return { skip: true, reason: 'synthetic', label: NO_MARKET_LABEL };
  }

  if (map.has(numericId)) {
    const reason = map.get(numericId);
    return {
      skip: true,
      reason,
      label: reason === 'account' ? NO_MARKET_ACCOUNT_LABEL : NO_MARKET_LABEL
    };
  }

  if (isLegendaryGiftLike(name)) {
    map.set(numericId, 'gift');
    return { skip: true, reason: 'gift', label: NO_MARKET_LABEL };
  }

  const typeLower = typeof type === 'string' ? type.toLowerCase() : '';
  if (typeLower.includes('account')) {
    map.set(numericId, 'account');
    return { skip: true, reason: 'account', label: NO_MARKET_ACCOUNT_LABEL };
  }

  return { skip: false, reason: null, label: null };
}

function getNonMarketEntriesForWorker() {
  return Array.from(getNonMarketMap().entries());
}
let donesWorkerInstance = null;

function applyCachedDataToNode(node) {
  if (!node || typeof node !== 'object') return;
  const numericId = Number(node.id);
  if (Number.isFinite(numericId)) {
    const itemInfo = getPreloadedItemData(numericId);
    if (itemInfo) {
      node.name = itemInfo.name ?? node.name;
      node.icon = itemInfo.icon ?? node.icon;
      node.rarity = itemInfo.rarity ?? node.rarity;
      node.type = itemInfo.type ?? node.type;
    }
    const priceInfo = getPreloadedPriceData(numericId);
    if (priceInfo) {
      if (node.buy_price == null && priceInfo.buy_price != null) {
        node.buy_price = priceInfo.buy_price;
      }
      if (node.sell_price == null && priceInfo.sell_price != null) {
        node.sell_price = priceInfo.sell_price;
      }
    }
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => applyCachedDataToNode(child));
  }
}

async function runDonesWorker(rootIngredients) {
  const preload = await ensurePreloadedIngredientData(rootIngredients);
  if (!donesWorkerInstance) {
    donesWorkerInstance = new Worker(new URL('./workers/donesWorker.js', import.meta.url), { type: 'module' });
  }
  const payload = {
    rootIngredients,
    skipEntries: getNonMarketEntriesForWorker(),
    preloadedItems: mapToPlainObject(preload?.items),
    preloadedPrices: mapToPlainObject(preload?.prices),
  };
  return new Promise((resolve, reject) => {
    const handleMessage = (e) => {
      donesWorkerInstance.removeEventListener('message', handleMessage);
      donesWorkerInstance.removeEventListener('error', handleError);
      resolve(e.data);
    };
    const handleError = (err) => {
      donesWorkerInstance.removeEventListener('message', handleMessage);
      donesWorkerInstance.removeEventListener('error', handleError);
      reject(err);
    };
    donesWorkerInstance.addEventListener('message', handleMessage);
    donesWorkerInstance.addEventListener('error', handleError);
    donesWorkerInstance.postMessage(payload);
  });
}

function runCostsWorker(ingredientTree, globalQty) {
  return runCostsWorkerTask({ ingredientTree, globalQty });
}

async function buildWorkerTree(ings) {
  const { ingredientTree } = await runDonesWorker(ings);
  const normalizedTree = Array.isArray(ingredientTree) ? ingredientTree : [];
  normalizedTree.forEach((node) => applyCachedDataToNode(node));
  const { updatedTree, totals } = await runCostsWorker(normalizedTree, 1);
  restoreCraftIngredientPrototypes(updatedTree, null);
  return { tree: updatedTree, totals };
}

function renderNodeHtml(node, level = 0) {
  const indent = level > 0 ? `padding-left:${level * 32}px;` : '';
  const status = resolveMarketStatus(node.id, node.name, node.type);
  const shouldShowNoMarket = status.skip;
  const noMarketLabel = status.label || NO_MARKET_LABEL;

  const hasBuyPrice = Number.isFinite(node.buy_price) && node.buy_price > 0;
  const hasSellPrice = Number.isFinite(node.sell_price) && node.sell_price > 0;
  const hasTotalBuy = Number.isFinite(node.total_buy) && node.total_buy > 0;
  const hasTotalSell = Number.isFinite(node.total_sell) && node.total_sell > 0;

  const hasOwnValue = (!shouldShowNoMarket && (hasBuyPrice || hasSellPrice)) || hasTotalBuy || hasTotalSell;

  const priceBuy = shouldShowNoMarket
    ? noMarketLabel
    : hasBuyPrice
      ? formatGoldColored(node.buy_price)
      : '-';
  const priceSell = shouldShowNoMarket
    ? noMarketLabel
    : hasSellPrice
      ? formatGoldColored(node.sell_price)
      : '-';
  const totalBuy = hasTotalBuy
    ? formatGoldColored(node.total_buy)
    : '-';
  const totalSell = hasTotalSell
    ? formatGoldColored(node.total_sell)
    : '-';

  let rowHtml = `<tr>
    <td style='${indent}'>${node.icon ? `<img src='${node.icon}' style='height:28px;'>` : '-'}</td>
    <td>${node.name}</td>
    <td>${Math.round(node.count)}</td>
    <td>${priceBuy}</td>
    <td>${priceSell}</td>
    <td>${totalBuy}</td>
    <td>${totalSell}</td>
  </tr>`;

  let childContributedValue = false;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const childResult = renderNodeHtml(child, level + 1);
      rowHtml += childResult.html;
      if (childResult.hasValue) {
        childContributedValue = true;
      }
    }
  }

  const hasValue = hasOwnValue || childContributedValue;
  const hasNoMarket = !hasValue;

  return { html: rowHtml, hasNoMarket, hasValue, childContributedValue };
}

function formatTotalsDisplay(total, hasMissingPrices) {
  if (hasMissingPrices) {
    return "<span class='total-sin-precio'>Sin precio (faltan componentes valorados)</span>";
  }
  if (Number.isFinite(total) && total > 0) {
    return formatGoldColored(total);
  }
  return '-';
}


async function renderDon(don, container) {
  // Si no se pasa un contenedor, se usa el global por defecto (comportamiento antiguo)
  const targetContainer = container || document.getElementById('dones-content');
  targetContainer.innerHTML = ''; // Limpiamos el contenedor específico para este don
  errorMsg.style.display = 'none';
  // No limpiar donesContent aquí, para permitir varios dones en la página (limpiaremos solo una vez afuera)
  try {
    await ensurePreloadedIngredientData([don]);
    // Si el id es ficticio (mayor a 90000) NO pedir a la API el don principal
    const donInfo = getPreloadedItemData(don.id);
    let donName = donInfo?.name || don.name;
    let donIcon = donInfo?.icon || null;
    if (!donIcon) {
      const primerIng = (don.manualIngredients && don.manualIngredients[0])
        || (don.mainIngredients && don.mainIngredients[0])
        || null;
      if (primerIng) {
        await ensurePreloadedIngredientData([primerIng]);
        const primerInfo = getPreloadedItemData(primerIng.id);
        if (primerInfo?.icon) {
          donIcon = primerInfo.icon;
        }
      }
    }
    // Renderizar mainIngredients en tabla separada si existen
    let html = '';
    // Para Don de la Suerte/Magia/Poder, SOLO una tabla anidada del árbol principal, sin encabezado ni títulos
    const nombre = don.name ? don.name.toLowerCase() : '';
    const esDonSimple = nombre.includes('suerte') || nombre.includes('magia') || nombre.includes('poder');
    if (esDonSimple) {
      if (don.mainIngredients && don.mainIngredients.length > 0) {
        html += `<table class='table-modern-dones tabla-tarjetas'>
          <thead class='header-items'><tr><th>Ícono</th><th>Nombre</th><th>Cantidad</th><th>Precio Compra (u)</th><th>Precio Venta (u)</th><th>Total Compra</th><th>Total Venta</th></tr></thead><tbody>`;
        let totalBuy = 0;
        let totalSell = 0;
        let hasMissingPrices = false;
        for (const ing of don.mainIngredients) {
          const result = await renderIngredientRowWithComponents(ing, 0);
          html += result.html;
          if (!result.hasValue) {
            hasMissingPrices = true;
          }
          if (Number.isFinite(result.totalBuy)) {
            totalBuy += result.totalBuy;
          }
          if (Number.isFinite(result.totalSell)) {
            totalSell += result.totalSell;
          }
        }
        html += `</tbody></table>`;
        if (hasMissingPrices || totalBuy > 0 || totalSell > 0) {
          const totalBuyDisplay = formatTotalsDisplay(totalBuy, hasMissingPrices);
          const totalSellDisplay = formatTotalsDisplay(totalSell, hasMissingPrices);
          html += `<div class='table-modern-totales' style='margin-bottom:50px;'>
            <div class='precio-totales-dones'>
              <div class='total-dones'><b>Total Compra estimado:</b> ${totalBuyDisplay}</div>
              <div class='total-dones'><b>Total Venta estimado:</b> ${totalSellDisplay}</div>
            </div>
          </div>`;
        }
      }
      targetContainer.innerHTML += html;
      return;
    }
    // Para otros dones, renderizado normal
    if (!esDonSimple) {
      html += `<h2 style='margin-top:18px;'><img src='${donIcon}' style='height:32px;vertical-align:middle;'> ${donName}</h2>`;
    }
    if (don.mainIngredients && don.mainIngredients.length > 0) {
      html += `<table class='table-modern-dones tabla-tarjetas'>
        <thead class='header-items'><tr><th>Ícono</th><th>Nombre</th><th>Cantidad</th><th>Precio Compra (u)</th><th>Precio Venta (u)</th><th>Total Compra</th><th>Total Venta</th></tr></thead><tbody>`;
      
      let totalBuy = 0;
      let totalSell = 0;
      let hasMissingPrices = false;

      for (const ing of don.mainIngredients) {
        const result = await renderIngredientRowWithComponents(ing, 0);
        html += result.html;
        if (!result.hasValue) {
          hasMissingPrices = true;
        }
        if (Number.isFinite(result.totalBuy)) {
          totalBuy += result.totalBuy;
        }
        if (Number.isFinite(result.totalSell)) {
          totalSell += result.totalSell;
        }
      }

      html += `</tbody></table>`;

      if (hasMissingPrices || totalBuy > 0 || totalSell > 0) {
        const totalBuyDisplay = formatTotalsDisplay(totalBuy, hasMissingPrices);
        const totalSellDisplay = formatTotalsDisplay(totalSell, hasMissingPrices);
        html += `<div class='table-modern-totales' style='margin-bottom:50px;'>
          <div class='precio-totales-dones'>
            <div class='total-dones'><b>Total Compra estimado:</b> ${totalBuyDisplay}</div>
            <div class='total-dones'><b>Total Venta estimado:</b> ${totalSellDisplay}</div>
          </div>
        </div>`;
      }
    }
    // Para el Don de la Suerte, Don de la Magia y Don del Poder, NO renderizar tabla manualIngredients, solo el árbol completo
    // Ya manejado arriba para esDonSimple
    if (esDonSimple) return;
    // El renderizado de ingredientes manuales ha sido eliminado completamente.
    targetContainer.innerHTML += html;
  } catch (e) {
    errorMsg.innerText = e.message;
    errorMsg.style.display = 'block';
  }
}

// === Dones de armas legendarias Gen 1 ===
async function extractWeaponGifts() {
  const { LEGENDARY_ITEMS } = window.LegendaryData || {};
  const gifts = [];
  const seen = new Set();
  for (const item of Object.values(LEGENDARY_ITEMS)) {
    if (!item.components) continue;
    const gift = item.components.find(c => {
      if (!c.name) return false;
      const lower = c.name.toLowerCase();
      return lower.startsWith('don de') && !lower.includes('la suerte') && !lower.includes('del dominio');
    });
    if (gift && !seen.has(gift.id)) {
      seen.add(gift.id);
      gifts.push({
        id: gift.id,
        name: gift.name,
        mainIngredients: gift.components || [],
        manualIngredients: []
      });
    }
  }
  // Orden alfabético por nombre
  gifts.sort((a,b)=>a.name.localeCompare(b.name,'es'));
  return gifts;
}

// Renderizar dones de armas legendarias de 1ra Gen
async function renderLegendaryWeaponGifts() {
  const container = document.getElementById('dones-1ra-gen-content');
  const skeleton = document.getElementById('dones-1ra-gen-skeleton');
  if (!container || !skeleton) return;

  showSkeleton(skeleton);
  container.innerHTML = '';

  try {
    const gifts = await extractWeaponGifts();
    const btnsDiv = document.createElement('div');
    btnsDiv.className = 'don1gen-nav-btns don1gen-grid';

    const resultDiv = document.createElement('div');
    resultDiv.id = 'don1gen-result';

    gifts.forEach((don) => {
      const btn = document.createElement('button');
      btn.className = 'dones-btn';
      btn.textContent = don.name;
      btn.addEventListener('click', async () => {
        btnsDiv.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        resultDiv.innerHTML = '';
        showSkeleton(skeleton);
        await renderDon(don, resultDiv);
        hideSkeleton(skeleton);
      });
      btnsDiv.appendChild(btn);
    });

    container.appendChild(btnsDiv);
    container.appendChild(resultDiv);
  } catch (error) {
    console.error('Error al renderizar dones de 1ra Gen:', error);
    container.innerHTML = '<div class="error-message">Error al cargar los dones.</div>';
  } finally {
    hideSkeleton(skeleton);
  }
}


// Renderizar dones especiales (los que no son de armas)
async function renderSpecialDons() {
  const container = document.getElementById('dones-content');
  const skeleton = donesSkeleton;
  showSkeleton(skeleton);
  container.innerHTML = '';

  // Renderizamos únicamente el Don de la Suerte (evitamos Magia y Poder para no duplicar tablas)
  const specialDons = DONES.filter(d => d.name && d.name.toLowerCase().includes('suerte')); 

  for (const don of specialDons) {
    const donContainer = document.createElement('div');
    container.appendChild(donContainer);
    await renderDon(don, donContainer);
  }
  hideSkeleton(skeleton);
}

// === Tributo Dracónico ===
async function getDraconicTribute() {
  const { LEGENDARY_ITEMS_3GEN } = window.LegendaryData || {};
  for (const weapon of Object.values(LEGENDARY_ITEMS_3GEN)) {
    const tribute = weapon.components?.find(c => {
      const nm = c.name?.toLowerCase() || '';
      return nm.includes('tributo dracónico');
    });
    if (tribute) return tribute; // Es único, lo devolvemos
  }
  throw new Error('No se encontró el Tributo Dracónico en legendaryItems3gen');
}

async function renderDraconicTribute() {
  const container = document.getElementById('tributo-draconico-content');
  const skeleton = document.getElementById('tributo-draconico-skeleton');
  if (!container || !skeleton) return;

  showSkeleton(skeleton);
  container.innerHTML = '';

  try {
    const tributoTree = await getDraconicTribute();
    let html = `<h2>${tributoTree.name}</h2>`;
    html += `<table class='table-modern-dones tabla-tarjetas'>
      <thead class='header-items'>
        <tr>
          <th>Ícono</th>
          <th>Nombre</th>
          <th>Cantidad</th>
          <th>Precio Compra (u)</th>
          <th>Precio Venta (u)</th>
          <th>Total Compra</th>
          <th>Total Venta</th>
        </tr>
      </thead>
      <tbody>`;

    let totalBuy = 0;
    let totalSell = 0;
    let hasMissingPrices = false;

    // Renderizar cada componente de nivel superior del tributo
    for (const component of tributoTree.components) {
      const result = await renderIngredientRowWithComponents(component, 0);
      html += result.html;
      if (!result.hasValue) {
        hasMissingPrices = true;
      }
      if (Number.isFinite(result.totalBuy)) {
        totalBuy += result.totalBuy;
      }
      if (Number.isFinite(result.totalSell)) {
        totalSell += result.totalSell;
      }
    }

    html += `</tbody></table>`;
    const shouldShowTotals = hasMissingPrices || totalBuy > 0 || totalSell > 0;
    if (shouldShowTotals) {
      const totalBuyDisplay = formatTotalsDisplay(totalBuy, hasMissingPrices);
      const totalSellDisplay = formatTotalsDisplay(totalSell, hasMissingPrices);
      html += `<div class='table-modern-totales' style='margin-bottom:50px;'>
        <div class='precio-totales-dones'>
          <div class='total-dones'><b>Total Compra estimado:</b> ${totalBuyDisplay}</div>
          <div class='total-dones'><b>Total Venta estimado:</b> ${totalSellDisplay}</div>
        </div>
      </div>`;
    }

    container.innerHTML = html;
  } catch (e) {
    console.error('Error al renderizar Tributo Dracónico:', e);
    container.innerHTML = '<div class="error-message">Error al cargar el Tributo Dracónico.</div>';
  } finally {
    hideSkeleton(skeleton);
  }
}

// Exponer funciones de carga perezosa para cada pestaña
const _loadedTabs = {
  special: false,
  tributo: false,
  draco: false,
  gen1: false
};

async function loadSpecialDons() {
  if (_loadedTabs.special) return;
  _loadedTabs.special = true;
  await renderSpecialDons();
}

async function loadTributo() {
  if (_loadedTabs.tributo) return;
  _loadedTabs.tributo = true;
  await renderTributo();
}

async function loadDraconicTribute() {
  if (_loadedTabs.draco) return;
  _loadedTabs.draco = true;
  await renderDraconicTribute();
}

async function loadDones1Gen() {
  if (_loadedTabs.gen1) return;
  _loadedTabs.gen1 = true;
  await renderLegendaryWeaponGifts();
}

window.DonesPages = {
  loadSpecialDons,
  loadTributo,
  loadDraconicTribute,
  loadDones1Gen
};

// === Tributo Dracónico ===
async function renderTributoDraconico() {
  const container = document.getElementById('tributo-draconico-content');
  const tributoDraconicoSkeleton = document.getElementById('tributo-draconico-skeleton');
  if (!container || !tributoDraconicoSkeleton) return;
  showSkeleton(tributoDraconicoSkeleton);
  container.innerHTML = '';
  try {
    if (TRIBUTO_DRACONICO.mainIngredients && TRIBUTO_DRACONICO.mainIngredients.length > 0) {
      let html = `<h3>Ingredientes principales</h3>`;
      html += `<table class='table-modern-dones tabla-tarjetas'><thead class='header-items'><tr><th>Ícono</th><th>Nombre</th><th>Cantidad</th><th>Precio Compra (u)</th><th>Precio Venta (u)</th><th>Total Compra</th><th>Total Venta</th></tr></thead><tbody>`;
      
      // Variables para acumular totales
      let totalBuy = 0;
      let totalSell = 0;
      let trebolBuy = 0;
      let trebolSell = 0;
      let piedrasBuy = 0;
      let piedrasSell = 0;
      let hasMissingPrices = false;

      // Procesar cada ingrediente principal
      for (const ing of TRIBUTO_DRACONICO.mainIngredients) {
        const result = await renderIngredientRowWithComponents(ing, 0);
        html += result.html;
        if (!result.hasValue) {
          hasMissingPrices = true;
        }

        // Solo sumar tréboles y piedras imán dracónicas
        if (ing.id === 19675) { // Trébol místico
          if (result.hasValue) {
            if (Number.isFinite(result.totalBuy)) {
              trebolBuy = result.totalBuy;
            }
            if (Number.isFinite(result.totalSell)) {
              trebolSell = result.totalSell;
            }
          }
        } else if (ing.id === 92687) { // Piedra imán dracónica amalgamada (ID corregido)
          if (result.hasValue) {
            if (Number.isFinite(result.totalBuy)) {
              piedrasBuy = result.totalBuy;
            }
            if (Number.isFinite(result.totalSell)) {
              piedrasSell = result.totalSell;
            }
          }
        } else {
        }
      }

      // Sumar solo los 38 tréboles y 5 piedras imán dracónicas
      totalBuy = trebolBuy + piedrasBuy;
      totalSell = trebolSell + piedrasSell;
      
      
      html += `</tbody></table>`;
      const shouldShowTotals = hasMissingPrices || totalBuy > 0 || totalSell > 0;
      if (shouldShowTotals) {
        const totalBuyDisplay = formatTotalsDisplay(totalBuy, hasMissingPrices);
        const totalSellDisplay = formatTotalsDisplay(totalSell, hasMissingPrices);
        html += `<div class="table-modern-totales" style="margin-bottom:50px;">
          <div class="precio-totales-dones">
            <div class="total-dones"><b>Total Compra estimado:</b> ${totalBuyDisplay}</div>
            <div class="total-dones"><b>Total Venta estimado:</b> ${totalSellDisplay}</div>
          </div>
        </div>`;
      }
      document.getElementById('tributo-draconico-content').insertAdjacentHTML('beforeend', html);
    }
    for (const don of TRIBUTO_DRACONICO.dons) {
      const donDiv = document.createElement('div');
      donDiv.className = 'don-section';
      const donTitle = document.createElement('h3');
      donTitle.textContent = don.name;
      donDiv.appendChild(donTitle);
      for (const subdon of don.subdons) {
        const subdonDiv = document.createElement('div');
        subdonDiv.className = 'subdon-section';
        const subdonTitle = document.createElement('h4');
        subdonTitle.textContent = subdon.name;
        subdonDiv.appendChild(subdonTitle);
        // Obtener datos de ingredientes
        await ensurePreloadedIngredientData(subdon.ingredients);
        const ingredientes = subdon.ingredients.map((ing) => buildManualIngredientDisplay(ing));
        // Renderizar tabla con lógica tradicional
        let totalBuy = 0;
        let totalSell = 0;
        let rowsHtml = '';
        let hasMissingPrices = false;
        ingredientes.forEach((ing, idx) => {
          const skipMarket = ing.marketStatus?.skip;
          const label = ing.marketStatus?.label || NO_MARKET_LABEL;
          const hasBuyPrice = Number.isFinite(ing.priceBuy) && ing.priceBuy > 0;
          const hasSellPrice = Number.isFinite(ing.priceSell) && ing.priceSell > 0;
          const missingEntry = skipMarket || (!hasBuyPrice && !hasSellPrice);
          if (missingEntry) {
            hasMissingPrices = true;
          }
          const totalBuyIng = hasBuyPrice ? ing.priceBuy * ing.count : null;
          const totalSellIng = hasSellPrice ? ing.priceSell * ing.count : null;
          if (Number.isFinite(totalBuyIng) && totalBuyIng > 0) totalBuy += totalBuyIng;
          if (Number.isFinite(totalSellIng) && totalSellIng > 0) totalSell += totalSellIng;
          const priceBuyCell = skipMarket
            ? label
            : (Number.isFinite(ing.priceBuy) && ing.priceBuy > 0 ? formatGoldColored(ing.priceBuy) : '-');
          const priceSellCell = skipMarket
            ? label
            : (Number.isFinite(ing.priceSell) && ing.priceSell > 0 ? formatGoldColored(ing.priceSell) : '-');
          const totalBuyCell = Number.isFinite(totalBuyIng) && totalBuyIng > 0
            ? formatGoldColored(totalBuyIng)
            : '-';
          const totalSellCell = Number.isFinite(totalSellIng) && totalSellIng > 0
            ? formatGoldColored(totalSellIng)
            : '-';
          rowsHtml += `
            <tr data-id='${ing.id}' class='${idx % 2 === 0 ? 'row-bg-a' : 'row-bg-b'}'>
              <td><img src='${ing.icon}' style='height:28px;'></td>
              <td>${ing.name}</td>
              <td>${Math.round(ing.count)}</td>
              <td>${priceBuyCell}</td>
              <td>${priceSellCell}</td>
              <td>${totalBuyCell}</td>
              <td>${totalSellCell}</td>
            </tr>`;
        });

        const tableHtml = `<table class='table-modern-dones tabla-tarjetas'>
          <thead class='header-items'><tr><th>Ícono</th><th>Nombre</th><th>Cantidad</th><th>Precio Compra (u)</th><th>Precio Venta (u)</th><th>Total Compra</th><th>Total Venta</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
        subdonDiv.insertAdjacentHTML('beforeend', tableHtml);

        const shouldShowTotals = hasMissingPrices || totalBuy > 0 || totalSell > 0;
        if (shouldShowTotals) {
          const totalBuyDisplay = formatTotalsDisplay(totalBuy, hasMissingPrices);
          const totalSellDisplay = formatTotalsDisplay(totalSell, hasMissingPrices);
          const totalsHtml = `<div class='table-modern-totales' style='margin-bottom:50px;'>
            <div class='precio-totales-dones'>
              <div class='total-dones'><b>Total Compra estimado:</b> ${totalBuyDisplay}</div>
              <div class='total-dones'><b>Total Venta estimado:</b> ${totalSellDisplay}</div>
            </div>
          </div>`;
          subdonDiv.insertAdjacentHTML('beforeend', totalsHtml);
        }
        donDiv.appendChild(subdonDiv);
      }
      container.appendChild(donDiv);
    }
  } catch (e) {
    container.innerHTML = '<div class="error-message">Error al cargar el Tributo Dracónico.</div>';
  } finally {
    hideSkeleton(tributoDraconicoSkeleton);
  }
}



// === Tributo Místico ===
const TRIBUTO = {
  name: "Tributo Místico",
  mainIngredients: [
    { id: 19675, name: "Trébol místico", type: "account_bound", count: 77, components: [
  { id: 19976, name: "Moneda mística", count: 250 },
  { id: 19721, name: "Pegote de ectoplasma", count: 250 },
  { id: 19925, name: "Esquirla de obsidiana", count: 250 },
  { id: 20796, name: "Piedra filosofal", count: 1500 }
]},
    { id: 19976, name: "Moneda mística", count: 250 }
  ],
  dons: [
    {
      name: "Don de magia condensada",
      subdons: [
        {
          name: "Don de sangre",
          ingredients: [
            { id: 24295, name: "Vial de sangre poderosa", count: 100 },
            { id: 24294, name: "Vial de sangre potente", count: 250 },
            { id: 24293, name: "Vial de sangre espesa", count: 50 },
            { id: 24292, name: "Vial de sangre", count: 50 },
          ]
        },
        {
          name: "Don de veneno",
          ingredients: [
            { id: 24283, name: "Vesícula de veneno poderoso", count: 100 },
            { id: 24282, name: "Vesícula de veneno potente", count: 250 },
            { id: 24281, name: "Vesícula de veneno llena", count: 50 },
            { id: 24280, name: "Vesícula de veneno", count: 50 },
          ]
        },
        {
          name: "Don de tótems",
          ingredients: [
            { id: 24300, name: "Tótem elaborado", count: 100 },
            { id: 24299, name: "Tótem intrincado", count: 250 },
            { id: 24298, name: "Tótem grabado", count: 50 },
            { id: 24297, name: "Tótem", count: 50 },
          ]
        },
        {
          name: "Don de polvo",
          ingredients: [
            { id: 24277, name: "Montón de polvo cristalino", count: 100 },
            { id: 24276, name: "Montón de polvo incandescente", count: 250 },
            { id: 24275, name: "Montón de polvo luminoso", count: 50 },
            { id: 24274, name: "Montón de polvo radiante", count: 50 },
          ]
        },
      ]
    },
    {
      name: "Don de poder condensado",
      subdons: [
        {
          name: "Don de garras",
          ingredients: [
            { id: 24351, name: "Garra despiadada", count: 100 },
            { id: 24350, name: "Garra grande", count: 250 },
            { id: 24349, name: "Garra afilada", count: 50 },
            { id: 24348, name: "Garra", count: 50 },
          ]
        },
        {
          name: "Don de escamas",
          ingredients: [
            { id: 24289, name: "Escama blindada", count: 100 },
            { id: 24288, name: "Escama grande", count: 250 },
            { id: 24287, name: "Escama suave", count: 50 },
            { id: 24286, name: "Escama", count: 50 },
          ]
        },
        {
          name: "Don de huesos",
          ingredients: [
            { id: 24358, name: "Hueso antiguo", count: 100 },
            { id: 24341, name: "Hueso grande", count: 250 },
            { id: 24345, name: "Hueso pesado", count: 50 },
            { id: 24344, name: "Hueso", count: 50 },
          ]
        },
        {
          name: "Don de colmillos",
          ingredients: [
            { id: 24357, name: "Colmillo feroz", count: 100 },
            { id: 24356, name: "Colmillo grande", count: 250 },
            { id: 24355, name: "Colmillo afilado", count: 50 },
            { id: 24354, name: "Colmillo", count: 50 },
          ]
        },
      ]
    }
  ]
};

// === Tributo Dracónico ===
const TRIBUTO_DRACONICO = {
  name: "Tributo dracónico",
  mainIngredients: [
    { id: 19675, name: "Trébol místico", type: "account_bound", count: 38, components: [
  { id: 19976, name: "Moneda mística", count: 38 },
  { id: 19721, name: "Pegote de ectoplasma", count: 38 },
  { id: 19925, name: "Esquirla de obsidiana", count: 38 },
  { id: 20796, name: "Piedra filosofal", count: 228 }
]},
    { id: 92687, name: "Piedra imán dracónica amalgamada", count: 5 }
  ],
  dons: [
    {
      name: "Don de magia condensada",
      subdons: [
        {
          name: "Don de sangre",
          ingredients: [
            { id: 24295, name: "Vial de sangre poderosa", count: 100 },
            { id: 24294, name: "Vial de sangre potente", count: 250 },
            { id: 24293, name: "Vial de sangre espesa", count: 50 },
            { id: 24292, name: "Vial de sangre", count: 50 }
          ]
        },
        {
          name: "Don de veneno",
          ingredients: [
            { id: 24283, name: "Vesícula de veneno poderoso", count: 100 },
            { id: 24282, name: "Vesícula de veneno potente", count: 250 },
            { id: 24281, name: "Vesícula de veneno llena", count: 50 },
            { id: 24280, name: "Vesícula de veneno", count: 50 }
          ]
        },
        {
          name: "Don de tótems",
          ingredients: [
            { id: 24300, name: "Tótem elaborado", count: 100 },
            { id: 24299, name: "Tótem intrincado", count: 250 },
            { id: 24298, name: "Tótem grabado", count: 50 },
            { id: 24297, name: "Tótem", count: 50 }
          ]
        },
        {
          name: "Don de polvo",
          ingredients: [
            { id: 24277, name: "Montón de polvo cristalino", count: 100 },
            { id: 24276, name: "Montón de polvo incandescente", count: 250 },
            { id: 24275, name: "Montón de polvo luminoso", count: 50 },
            { id: 24274, name: "Montón de polvo radiante", count: 50 }
          ]
        }
      ]
    },
    {
      name: "Don de poder condensado",
      subdons: [
        {
          name: "Don de garras",
          ingredients: [
            { id: 24351, name: "Garra despiadada", count: 100 },
            { id: 24350, name: "Garra grande", count: 250 },
            { id: 24349, name: "Garra afilada", count: 50 },
            { id: 24348, name: "Garra", count: 50 }
          ]
        },
        {
          name: "Don de escamas",
          ingredients: [
            { id: 24289, name: "Escama blindada", count: 100 },
            { id: 24288, name: "Escama grande", count: 250 },
            { id: 24287, name: "Escama suave", count: 50 },
            { id: 24286, name: "Escama", count: 50 }
          ]
        },
        {
          name: "Don de huesos",
          ingredients: [
            { id: 24358, name: "Hueso antiguo", count: 100 },
            { id: 24341, name: "Hueso grande", count: 250 },
            { id: 24345, name: "Hueso pesado", count: 50 },
            { id: 24344, name: "Hueso", count: 50 }
          ]
        },
        {
          name: "Don de colmillos",
          ingredients: [
            { id: 24357, name: "Colmillo feroz", count: 100 },
            { id: 24356, name: "Colmillo grande", count: 250 },
            { id: 24355, name: "Colmillo afilado", count: 50 },
            { id: 24354, name: "Colmillo", count: 50 }
          ]
        }
      ]
    }
  ]
};

// Renderiza una fila y sus subcomponentes recursivamente
// Devuelve un objeto con {html, totalBuy, totalSell, hasNoMarket, hasValue}
async function renderIngredientRowWithComponents(ing, level = 0) {
  const { tree } = await buildWorkerTree([ing]);
  const node = tree[0];
  if (!Array.isArray(node.children) || node.children.length === 0) {
    const count = Number.isFinite(node.count) ? node.count : 0;
    const buyPrice = Number.isFinite(node.buy_price) ? node.buy_price : 0;
    const sellPrice = Number.isFinite(node.sell_price) ? node.sell_price : 0;
    node.total_buy = buyPrice * count;
    node.total_sell = sellPrice * count;
  }
  const { html, hasNoMarket, hasValue } = renderNodeHtml(node, level);
  const totalBuy = Number.isFinite(node.total_buy) ? node.total_buy : null;
  const totalSell = Number.isFinite(node.total_sell) ? node.total_sell : null;
  return { html, totalBuy, totalSell, hasNoMarket, hasValue };
}

// Construye un árbol de componentes completo y unificado para el Tributo Místico
function buildTributoTree() {
  const root = {
    id: 'TRIBUTO_MISTICO_ROOT',
    name: TRIBUTO.name,
    count: 1,
    components: []
  };

  // 1. Añadir ingredientes principales (Trébol Místico)
  // renderIngredientRowWithComponents se encargará de sus sub-componentes
  TRIBUTO.mainIngredients.forEach(ing => {
    root.components.push({ ...ing });
  });

  // 2. Procesar los dones principales (Magia y Poder Condensado)
  TRIBUTO.dons.forEach(don => {
        const donCount = (don.name.toLowerCase().includes('magia condensada') || don.name.toLowerCase().includes('poder condensado')) ? 2 : 1;
    const donNode = {
      id: don.name.replace(/\s+/g, '_').toUpperCase(), // ID único para el don
      name: don.name,
      count: donCount,
      components: []
    };

    // 3. Procesar los subdones (Sangre, Veneno, etc.)
    don.subdons.forEach(subdon => {
      const subdonNode = {
        id: subdon.name.replace(/\s+/g, '_').toUpperCase(), // ID único para el subdon
        name: subdon.name,
        count: 1,
        components: []
      };
      
      // 4. Añadir los ingredientes finales al subdon
      subdon.ingredients.forEach(ingredient => {
        subdonNode.components.push({ ...ingredient });
      });
      
      donNode.components.push(subdonNode);
    });
    
    root.components.push(donNode);
  });

  return root;
}


// Renderiza el Tributo Místico como un árbol único y anidado
async function renderTributo() {
  const container = document.getElementById('tributo-content');
  const skeleton = document.getElementById('tributo-skeleton');
  if (!container || !skeleton) return;

  showSkeleton(skeleton);
  container.innerHTML = ''; // Limpiar contenido previo

  try {
    const tributoTree = buildTributoTree();

    let html = `<h2>${tributoTree.name}</h2>`;
    html += `<table class='table-modern-dones tabla-tarjetas'>
      <thead class='header-items'>
        <tr>
          <th>Ícono</th>
          <th>Nombre</th>
          <th>Cantidad</th>
          <th>Precio Compra (u)</th>
          <th>Precio Venta (u)</th>
          <th>Total Compra</th>
          <th>Total Venta</th>
        </tr>
      </thead>
      <tbody>`;

    let totalBuy = 0;
    let totalSell = 0;
    let hasMissingPrices = false;

    // Renderizar cada componente de nivel superior del árbol de forma recursiva
    for (const component of tributoTree.components) {
      const result = await renderIngredientRowWithComponents(component, 0); // Iniciar en nivel 0
      html += result.html;
      if (!result.hasValue) {
        hasMissingPrices = true;
      }
      if (Number.isFinite(result.totalBuy)) {
        totalBuy += result.totalBuy;
      }
      if (Number.isFinite(result.totalSell)) {
        totalSell += result.totalSell;
      }
    }

    html += `</tbody></table>`;

    // Mostrar los totales generales
    const shouldShowTotals = hasMissingPrices || totalBuy > 0 || totalSell > 0;
    if (shouldShowTotals) {
      const totalBuyDisplay = formatTotalsDisplay(totalBuy, hasMissingPrices);
      const totalSellDisplay = formatTotalsDisplay(totalSell, hasMissingPrices);
      html += `<div class='table-modern-totales' style='margin-bottom:18px;'>
        <div class='precio-totales-dones'>
          <div class='total-dones'><b>Total Compra estimado:</b> ${totalBuyDisplay}</div>
          <div class='total-dones'><b>Total Venta estimado:</b> ${totalSellDisplay}</div>
        </div>
      </div>`;
    }

    container.innerHTML = html;

  } catch (error) {
    console.error("Error al renderizar Tributo Místico:", error);
    container.innerHTML = '<div class="error-message">Error al cargar el Tributo Místico.</div>';
  } finally {
    hideSkeleton(skeleton);
  }
}


