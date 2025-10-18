import { getConfig } from '../config.js';
import {
  joinApiPath,
  mergeItemDetailsIntoMap,
  mergeMarketEntriesFromCsv,
  mergeMarketEntriesFromJson,
} from '../services/internalItemApi.js';

const DEFAULT_GUARD_CONFIG = {
  FETCH_GUARD_MODE: 'enforce',
  FETCH_GUARD_WHITELIST: [
    'self',
    '/recipe-tree',
    'https://www.google-analytics.com',
    'https://region1.google-analytics.com',
    'https://www.googletagmanager.com',
  ],
  FETCH_GUARD_REPORT_URL: null,
  CONNECT_ALLOWLIST: [],
};

let fetchWithCache;
let normalizeApiResponse;
let dependenciesPromise = null;
let guardConfigApplied = false;

function ensureGuardConfig(config) {
  const source = (config && typeof config === 'object') ? config : {};
  const normalizedWhitelist = normalizeWhitelist(source.FETCH_GUARD_WHITELIST);

  const normalizedConfig = {
    ...source,
    FETCH_GUARD_MODE: typeof source.FETCH_GUARD_MODE === 'string'
      ? source.FETCH_GUARD_MODE
      : DEFAULT_GUARD_CONFIG.FETCH_GUARD_MODE,
    FETCH_GUARD_WHITELIST: normalizedWhitelist,
    FETCH_GUARD_REPORT_URL: Object.prototype.hasOwnProperty.call(source, 'FETCH_GUARD_REPORT_URL')
      ? source.FETCH_GUARD_REPORT_URL
      : DEFAULT_GUARD_CONFIG.FETCH_GUARD_REPORT_URL,
    CONNECT_ALLOWLIST: Array.isArray(source.CONNECT_ALLOWLIST)
      ? [...source.CONNECT_ALLOWLIST]
      : [...DEFAULT_GUARD_CONFIG.CONNECT_ALLOWLIST],
  };

  self.__RUNTIME_CONFIG__ = {
    ...(self.__RUNTIME_CONFIG__ || {}),
    ...normalizedConfig,
  };

  guardConfigApplied = true;
}

function normalizeWhitelist(value) {
  const entries = new Set();
  const addEntry = (entry) => {
    if (!entry) return;
    entries.add(entry);
  };

  const processValue = (val) => {
    if (val == null) return;
    if (Array.isArray(val)) {
      val.forEach(processValue);
      return;
    }
    if (typeof val === 'string') {
      val
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach(addEntry);
      return;
    }
    try {
      addEntry(String(val));
    } catch {
      /* ignore conversion issues */
    }
  };

  processValue(DEFAULT_GUARD_CONFIG.FETCH_GUARD_WHITELIST);
  processValue(value);

  return Array.from(entries);
}

function ensureDependenciesLoaded() {
  if (!dependenciesPromise) {
    dependenciesPromise = Promise.all([
      import('../utils/requestCache.js'),
      import('../utils/apiResponse.js'),
    ]).then(([requestCacheModule, apiResponseModule]) => {
      const overrides = typeof self !== 'undefined' && self?.__TEST_OVERRIDES__
        ? self.__TEST_OVERRIDES__
        : null;
      fetchWithCache = overrides?.fetchWithCache || requestCacheModule.fetchWithCache;
      normalizeApiResponse = overrides?.normalizeApiResponse || apiResponseModule.normalizeApiResponse;
    });
  }
  return dependenciesPromise;
}

self.onmessage = async (e) => {
  const message = e.data || {};
  const { type } = message;

  if (type === 'runtimeConfig') {
    ensureGuardConfig(message.config);
    await ensureDependenciesLoaded();
    return;
  }

  if (!guardConfigApplied) {
    ensureGuardConfig(null);
  }

  await ensureDependenciesLoaded();

  const { mainItemId, mainRecipeData } = message;
  try {
    const tree = await prepareIngredientTreeData(mainItemId, mainRecipeData);
    self.postMessage({ tree });
  } catch (err) {
    const fallbackMessage = typeof err?.message === 'string' && err.message
      ? err.message
      : String(err || 'Unknown error');
    self.postMessage({ error: fallbackMessage });
  }
};

async function prepareIngredientTreeData(mainItemId, mainRecipeData) {
  let rootNested = await fetchBackendTree(mainItemId);
  let allItemsDetailsMap = new Map();
  let marketDataMap = new Map();

  if (!rootNested || !Array.isArray(rootNested.components) || rootNested.components.length === 0) {
    const fallback = await buildTreeFromRecipe(mainItemId, mainRecipeData);
    if (!fallback) return [];
    rootNested = fallback.root;
    allItemsDetailsMap = fallback.allItemsDetailsMap;
    marketDataMap = fallback.marketDataMap;
  }

  if (!rootNested) return [];

  const allItemIds = collectAllItemIds(rootNested);
  await populateItemDetails(allItemIds, allItemsDetailsMap);
  await populateMarketData(allItemIds, marketDataMap);

  const root = convertComponent(rootNested, allItemsDetailsMap, marketDataMap, null);
  return root ? root.children || [] : [];
}

async function fetchBackendTree(mainItemId) {
  try {
    const response = await fetchWithCache(`/recipe-tree/${mainItemId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function buildTreeFromRecipe(mainItemId, mainRecipeData) {
  if (!mainRecipeData || !Array.isArray(mainRecipeData.ingredients) || mainRecipeData.ingredients.length === 0) {
    return null;
  }

  const allItemsDetailsMap = new Map();
  const marketDataMap = new Map();
  const bundleCache = new Map();

  const ensureBundles = async (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const unique = [];
    ids.forEach((id) => {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) return;
      if (!bundleCache.has(numericId)) unique.push(numericId);
    });
    if (unique.length === 0) return;
    for (let i = 0; i < unique.length; i += 25) {
      const chunk = unique.slice(i, i + 25);
      const query = chunk.map((id) => `ids[]=${id}`).join('&');
      try {
        const resp = await fetchWithCache(`/backend/api/dataBundle.php?${query}`);
        if (!resp.ok) continue;
        const payload = await resp.json().catch(() => null);
        const { data, meta } = normalizeApiResponse(payload);
        const entries = Array.isArray(data) ? data : [];
        if (!Array.isArray(data) && Array.isArray(meta?.errors) && meta.errors.length) {
          console.warn('dataBundle (worker) devolvió errores', meta.errors);
        }
        if (entries.length) {
          entries.forEach((entry) => {
            if (!entry || typeof entry.id !== 'number') return;
            bundleCache.set(entry.id, entry);
            if (entry.item) {
              allItemsDetailsMap.set(entry.id, entry.item);
            }
            if (entry.market && (entry.market.buy_price != null || entry.market.sell_price != null)) {
              marketDataMap.set(entry.id, {
                id: entry.id,
                buy_price: entry.market.buy_price != null ? entry.market.buy_price : null,
                sell_price: entry.market.sell_price != null ? entry.market.sell_price : null,
              });
            }
          });
        }
      } catch (err) {
        // ignore bundle errors
      } finally {
        chunk.forEach((id) => {
          if (!bundleCache.has(id)) bundleCache.set(id, null);
        });
      }
    }
  };

  const buildRecipeNode = async (recipe, itemId, quantity, stack) => {
    if (!Number.isInteger(itemId) || itemId <= 0) return null;
    await ensureBundles([itemId]);

    const currentKey = `${itemId}`;
    if (stack.has(currentKey)) {
      return {
        id: itemId,
        quantity: quantity ?? 1,
        recipe: normalizeRecipe(recipe, itemId),
        components: [],
        type: 'Recipe',
      };
    }

    stack.add(currentKey);
    const normalized = normalizeRecipe(recipe, itemId);
    const ingredients = Array.isArray(normalized.ingredients) ? normalized.ingredients : [];
    const ingredientIds = ingredients
      .map((ing) => (Number.isInteger(ing?.item_id) ? ing.item_id : null))
      .filter((id) => id);
    if (ingredientIds.length > 0) {
      await ensureBundles(ingredientIds);
    }

    const components = [];
    for (const ing of ingredients) {
      const ingId = Number(ing?.item_id);
      if (!Number.isInteger(ingId) || ingId <= 0) continue;
      const ingCount = Number.isFinite(ing?.count) ? ing.count : 0;
      const bundle = bundleCache.get(ingId);
      if (bundle && bundle.recipe && Array.isArray(bundle.recipe.ingredients) && bundle.recipe.ingredients.length > 0) {
        const childNode = await buildRecipeNode(bundle.recipe, ingId, ingCount, stack);
        if (childNode) {
          childNode.type = 'Recipe';
          components.push(childNode);
        }
      } else {
        components.push({
          type: 'Item',
          id: ingId,
          quantity: ingCount,
        });
      }
    }
    stack.delete(currentKey);

    return {
      id: itemId,
      quantity: quantity ?? 1,
      recipe: normalized,
      components,
      type: 'Recipe',
    };
  };

  await ensureBundles([mainItemId]);
  const rootNode = await buildRecipeNode(mainRecipeData, mainItemId, mainRecipeData.output_item_count ?? 1, new Set());
  if (!rootNode) return null;

  return {
    root: rootNode,
    allItemsDetailsMap,
    marketDataMap,
  };
}

function collectAllItemIds(root) {
  const ids = new Set();
  (function gather(node) {
    if (!node || typeof node !== 'object') return;
    if (Number.isInteger(node.id)) ids.add(node.id);
    if (Array.isArray(node.components)) {
      node.components.forEach((comp) => {
        if (!comp) return;
        if (comp.type === 'Recipe') gather(comp);
        else if (comp.type === 'Item' && Number.isInteger(comp.id)) ids.add(comp.id);
      });
    }
  })(root);
  return ids;
}

async function populateItemDetails(allItemIds, allItemsDetailsMap) {
  const missing = Array.from(allItemIds).filter((id) => !allItemsDetailsMap.has(id));
  if (missing.length === 0) return;
  const { API_BASE_URL, LANG } = getConfig();
  const langParam = typeof LANG === 'string' && LANG.trim() ? LANG.trim() : 'es';
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    const params = new URLSearchParams();
    params.set('ids', chunk.join(','));
    if (langParam) params.set('lang', langParam);
    const url = `${joinApiPath(API_BASE_URL, '/items')}?${params.toString()}`;
    try {
      const resp = await fetchWithCache(url);
      if (!resp.ok) continue;
      const payload = await resp.json().catch(() => null);
      mergeItemDetailsIntoMap(allItemsDetailsMap, payload);
    } catch (err) {
      // ignore detail fetch errors
    }
  }
}

async function populateMarketData(allItemIds, marketDataMap) {
  const idsArray = Array.from(allItemIds).filter((id) => Number.isInteger(id) && id > 0);
  if (idsArray.length === 0) return;

  const {
    API_BASE_URL,
    MARKET_CSV_URL,
    FEATURE_MARKET_CSV_EXTERNAL,
    FEATURE_MARKET_CSV_EXTERNAL_WORKER,
  } = getConfig();
  const shouldUseExternalCsv = FEATURE_MARKET_CSV_EXTERNAL_WORKER != null
    ? Boolean(FEATURE_MARKET_CSV_EXTERNAL_WORKER)
    : Boolean(FEATURE_MARKET_CSV_EXTERNAL);
  // NOTE: By default the worker always targets the internal proxy endpoint.
  // External CSV usage now requires the FEATURE_MARKET_CSV_EXTERNAL_WORKER flag.
  const csvBase = shouldUseExternalCsv
    ? (typeof MARKET_CSV_URL === 'string' && MARKET_CSV_URL.trim()
      ? MARKET_CSV_URL.trim()
      : 'https://api.datawars2.ie/gw2/v1/items/csv')
    : joinApiPath(API_BASE_URL, '/market.csv');
  const csvParams = new URLSearchParams();
  csvParams.set('ids', idsArray.join(','));
  try {
    const csvUrl = `${csvBase}?${csvParams.toString()}`;
    const resp = await fetchWithCache(csvUrl);
    if (resp.ok) {
      const csvText = await resp.text();
      mergeMarketEntriesFromCsv(marketDataMap, csvText);
    }
  } catch (err) {
    // ignore CSV errors
  }

  const missingIds = idsArray.filter((id) => !marketDataMap.has(id));
  if (missingIds.length === 0) return;

  for (let i = 0; i < missingIds.length; i += 200) {
    const chunk = missingIds.slice(i, i + 200);
    const params = new URLSearchParams();
    params.set('ids', chunk.join(','));
    const url = `${joinApiPath(API_BASE_URL, '/prices')}?${params.toString()}`;
    try {
      const resp = await fetchWithCache(url);
      if (!resp.ok) continue;
      const payload = await resp.json().catch(() => null);
      if (!payload) continue;
      const entries =
        payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')
          ? payload.data
          : payload;
      mergeMarketEntriesFromJson(marketDataMap, entries);
    } catch (err) {
      // ignore market errors
    }
  }
}

function convertComponent(node, allItemsDetailsMap, marketDataMap, parentId = null) {
  if (!node) return null;
  const itemDetail = allItemsDetailsMap.get(node.id);
  if (!itemDetail) return null;
  const marketInfo = marketDataMap.get(node.id) || {};
  const isCraftable = Array.isArray(node.components) && node.components.length > 0;
  let children = [];

  if (isCraftable) {
    children = node.components
      .map((comp) => {
        if (comp.type === 'Recipe') {
          return convertComponent(comp, allItemsDetailsMap, marketDataMap, itemDetail.id);
        }
        if (comp.type === 'Item') {
          const detail = allItemsDetailsMap.get(comp.id);
          if (!detail) return null;
          const mInfo = marketDataMap.get(comp.id) || {};
          return {
            id: detail.id,
            name: detail.name,
            icon: detail.icon,
            rarity: detail.rarity,
            count: comp.quantity,
            buy_price: mInfo.buy_price ?? null,
            sell_price: mInfo.sell_price ?? null,
            crafted_price: null,
            is_craftable: false,
            recipe: null,
            children: [],
            _parentId: itemDetail.id,
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  return {
    id: itemDetail.id,
    name: itemDetail.name,
    icon: itemDetail.icon,
    rarity: itemDetail.rarity,
    count: node.quantity,
    buy_price: marketInfo.buy_price ?? null,
    sell_price: marketInfo.sell_price ?? null,
    crafted_price: null,
    is_craftable: isCraftable,
    recipe: node.recipe || null,
    children,
    _parentId: parentId,
  };
}

function normalizeRecipe(recipe, itemId) {
  if (!recipe || typeof recipe !== 'object') {
    return {
      id: null,
      output_item_id: itemId ?? null,
      output_item_count: 1,
      ingredients: [],
    };
  }
  const normalizedIngredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((ing) => ({
        item_id: ing?.item_id ?? null,
        count: ing?.count ?? 0,
      }))
    : [];
  return {
    id: recipe.id ?? null,
    output_item_id: recipe.output_item_id ?? itemId ?? null,
    output_item_count: recipe.output_item_count ?? 1,
    ingredients: normalizedIngredients,
  };
}

