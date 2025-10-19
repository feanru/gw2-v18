// Common item functions used across item and compare views
// Copied from original item.js for reuse

import { getCached, setCached } from './utils/cache.js';
import { fetchWithCache } from './utils/requestCache.js';
import { getPrice, preloadPrices } from './utils/priceHelper.js';
import { normalizeApiResponse } from './utils/apiResponse.js';
import { isFeatureEnabled } from './utils/featureFlags.js';
import { fetchItemAggregate } from './services/aggregateService.mjs';
import { toUiModel } from './adapters/aggregateAdapter.js';
import { renderFreshnessBanner, hideFreshnessBanner } from './utils/freshnessBanner.js';
import './services/recipeService.js';
import { runCostsWorkerTask } from './workers/costsWorkerClient.js';

const runtimeWindow = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);

if (typeof window !== 'undefined') {
  runtimeWindow.ingredientObjs = runtimeWindow.ingredientObjs || [];
  runtimeWindow.globalQty = runtimeWindow.globalQty || 1;
  runtimeWindow._mainBuyPrice = runtimeWindow._mainBuyPrice || 0;
  runtimeWindow._mainSellPrice = runtimeWindow._mainSellPrice || 0;
  runtimeWindow._mainRecipeOutputCount = runtimeWindow._mainRecipeOutputCount || 1;
}

function getWorkerGuardConfig() {
  const runtimeConfig = runtimeWindow && typeof runtimeWindow.__RUNTIME_CONFIG__ === 'object'
    ? runtimeWindow.__RUNTIME_CONFIG__
    : null;

  if (!runtimeConfig) {
    return null;
  }

  const config = {};

  if (typeof runtimeConfig.FETCH_GUARD_MODE === 'string') {
    config.FETCH_GUARD_MODE = runtimeConfig.FETCH_GUARD_MODE;
  }

  if (Array.isArray(runtimeConfig.FETCH_GUARD_WHITELIST)) {
    config.FETCH_GUARD_WHITELIST = [...runtimeConfig.FETCH_GUARD_WHITELIST];
  } else if (typeof runtimeConfig.FETCH_GUARD_WHITELIST === 'string') {
    config.FETCH_GUARD_WHITELIST = runtimeConfig.FETCH_GUARD_WHITELIST
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (Object.prototype.hasOwnProperty.call(runtimeConfig, 'FETCH_GUARD_REPORT_URL')) {
    config.FETCH_GUARD_REPORT_URL = runtimeConfig.FETCH_GUARD_REPORT_URL;
  }

  if (Array.isArray(runtimeConfig.CONNECT_ALLOWLIST)) {
    config.CONNECT_ALLOWLIST = [...runtimeConfig.CONNECT_ALLOWLIST];
  }

  return config;
}

export function setIngredientObjs(val) {
  if (Array.isArray(val)) {
    restoreCraftIngredientPrototypes(val, null);
  }
  runtimeWindow.ingredientObjs = val;
}

// -------------------------
// Core data structures
// -------------------------

export class CraftIngredient {
  constructor({id, name, icon, rarity, count, buy_price, sell_price, is_craftable, recipe, children = [], _parentId = null}) {
    this._uid = CraftIngredient.nextUid++;
    this.id = id;
    this.name = name;
    this.icon = icon;
    this.rarity = rarity;
    this.count = count;
    this.buy_price = buy_price;
    this.sell_price = sell_price;
    this.is_craftable = is_craftable;
    this.recipe = recipe || null;
    this.children = children;
    this.mode = 'buy';
    this.modeForParentCrafted = 'buy';
    this.expanded = false;
    this._parentId = _parentId;
    this._parent = null;
    this.countTotal = 0;
    this.crafted_price = null;
    this.total_buy = 0;
    this.total_sell = 0;
    this.total_crafted = 0;
  }

  findRoot() {
    let current = this;
    while (current._parent) current = current._parent;
    return current;
  }

  setMode(newMode) {
    if (['buy', 'sell', 'crafted'].includes(newMode)) {
      this.modeForParentCrafted = newMode;
      const root = this.findRoot();
      root.recalc(runtimeWindow.globalQty || 1, null);
      if (typeof runtimeWindow.safeRenderTable === 'function') runtimeWindow.safeRenderTable();
    }
  }

  recalc(globalQty = 1, parent = null, options = {}) {
    const { skipCountTotalUpdate = false } = options;
    const isRoot = parent == null;
    const isMysticCloverSpecial = this.id === 19675 && (this.count === 77 || this.count === 38);
    if (isRoot) {
      this.countTotal = this.count * globalQty;
    } else if (isMysticCloverSpecial) {
      this.countTotal = this.count;
    } else if (!skipCountTotalUpdate) {
      this.countTotal = parent.countTotal * this.count;
    }

    if (this.children && this.children.length > 0) {
      if (isMysticCloverSpecial) {
        const manualCounts = this.count === 77 ? [250, 250, 250, 1500] : [38, 38, 38, 38];
        this.children.forEach((child, idx) => {
          child.countTotal = manualCounts[idx] || 0;
          child.total_buy = (child.buy_price || 0) * child.countTotal;
          child.total_sell = (child.sell_price || 0) * child.countTotal;
          child.recalc(globalQty, this, { skipCountTotalUpdate: true });
        });
      } else {
        this.children.forEach(child => child.recalc(globalQty, this));
      }
    }

    if (isRoot) {
      if (this.children && this.children.length > 0) {
        this.total_buy = this.children.reduce((s, c) => s + (c.total_buy || 0), 0);
        this.total_sell = this.children.reduce((s, c) => s + (c.total_sell || 0), 0);
      } else {
        this.total_buy = (this.buy_price || 0) * this.countTotal;
        this.total_sell = (this.sell_price || 0) * this.countTotal;
      }
    } else if (isMysticCloverSpecial) {
      this.total_buy = this.children.reduce((s, c) => s + (c.total_buy || 0), 0);
      this.total_sell = this.children.reduce((s, c) => s + (c.total_sell || 0), 0);
    } else {
      this.total_buy = (this.buy_price || 0) * this.countTotal;
      this.total_sell = (this.sell_price || 0) * this.countTotal;
    }

    if (this.is_craftable && this.children.length > 0) {
      this.total_crafted = this.children.reduce((sum, ing) => {
        switch (ing.modeForParentCrafted) {
          case 'buy': return sum + (ing.total_buy || 0);
          case 'sell': return sum + (ing.total_sell || 0);
          case 'crafted': return sum + (ing.total_crafted || 0);
          default: return sum + (ing.total_buy || 0);
        }
      }, 0);
      this.crafted_price = this.total_crafted / (this.recipe?.output_item_count || 1);
      // Nota: total_crafted se deriva exclusivamente del modo
      // (modeForParentCrafted) de cada hijo y no debe ser
      // sobrescrito fuera de este método.

      if (!isRoot && (!this.buy_price && !this.sell_price)) {
        this.total_buy = this.children.reduce((s, c) => s + (c.total_buy || 0), 0);
        this.total_sell = this.children.reduce((s, c) => s + (c.total_sell || 0), 0);
      }
    } else {
      this.total_crafted = null;
      this.crafted_price = null;
    }
  }

  getBestPrice() {
    if (typeof this.buy_price === 'number' && this.buy_price > 0) return this.buy_price;
    if (typeof this.crafted_price === 'number' && this.crafted_price > 0) return this.crafted_price;
    return 0;
  }
}

CraftIngredient.nextUid = 0;

export function restoreCraftIngredientPrototypes(nodes, parent = null) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    Object.setPrototypeOf(node, CraftIngredient.prototype);
    if (typeof node._uid === 'number' && CraftIngredient.nextUid <= node._uid) {
      CraftIngredient.nextUid = node._uid + 1;
    }
    node._parent = parent;
    if (parent) node._parentId = parent._uid;
    if (Array.isArray(node.children) && node.children.length > 0) {
      restoreCraftIngredientPrototypes(node.children, node);
    } else {
      node.children = [];
    }
  }
}

export function setGlobalQty(val) {
  runtimeWindow.globalQty = val;
}

export function snapshotExpandState(ings) {
  if (!ings) return [];
  return ings.map(ing => ({
    id: ing.id,
    expanded: ing.expanded,
    children: snapshotExpandState(ing.children || [])
  }));
}

export function restoreExpandState(ings, snapshot) {
  if (!ings || !snapshot) return;
  for (let i = 0; i < ings.length; i++) {
    if (snapshot[i]) {
      ings[i].expanded = snapshot[i].expanded;
      restoreExpandState(ings[i].children, snapshot[i].children);
    }
  }
}

let lastTotals = { totalBuy: 0, totalSell: 0, totalCrafted: 0 };

export function setTotalsFromAggregate(totals) {
  const buy = Number(totals?.buy ?? totals?.totalBuy ?? 0);
  const sell = Number(totals?.sell ?? totals?.totalSell ?? 0);
  const crafted = Number(totals?.crafted ?? totals?.totalCrafted ?? 0);
  lastTotals = {
    totalBuy: Number.isFinite(buy) ? buy : 0,
    totalSell: Number.isFinite(sell) ? sell : 0,
    totalCrafted: Number.isFinite(crafted) ? crafted : 0,
  };
}

export function recalcAll(ingredientObjs, globalQty) {
  if (!ingredientObjs) return Promise.resolve();
  return runCostsWorkerTask({ ingredientTree: ingredientObjs, globalQty }).then(({ updatedTree, totals }) => {
    if (Array.isArray(updatedTree)) {
      restoreCraftIngredientPrototypes(updatedTree, null);
    }

    function apply(src, dest) {
      Object.assign(dest, src);
      if (src.children && dest.children) {
        for (let i = 0; i < src.children.length; i++) {
          apply(src.children[i], dest.children[i]);
        }
      }
    }

    if (Array.isArray(updatedTree)) {
      for (let i = 0; i < updatedTree.length; i++) {
        apply(updatedTree[i], ingredientObjs[i]);
      }
    }
    lastTotals = totals || { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
  });
}

// Devuelve los últimos totales globales calculados por recalcAll.
// Siempre ejecutar recalcAll antes de llamar para obtener datos actualizados.
// Siempre retorna los totales globales y no acepta parámetros.
export function getTotals() {
  return lastTotals;
}

export function findIngredientByIdAndParent(ings, id, parentId) {
  for (const ing of ings) {
    if (String(ing.id) === String(id) && String(ing._parentId) === String(parentId)) {
      return ing;
    }
    if (Array.isArray(ing.children) && ing.children.length) {
      const found = findIngredientByIdAndParent(ing.children, id, parentId);
      if (found) return found;
    }
  }
  return null;
}

export function findIngredientByPath(ings, pathArr) {
  let current = ings;
  let ing = null;
  for (let i = 0; i < pathArr.length; i++) {
    const val = pathArr[i];
    ing = (current || []).find(n => String(n._uid) === String(val) || String(n.id) === String(val));
    if (!ing) return null;
    current = ing.children;
  }
  return ing;
}

export function findIngredientByUid(ings, uid) {
  for (const ing of ings) {
    if (String(ing._uid) === String(uid)) return ing;
    if (ing.children && ing.children.length) {
      const found = findIngredientByUid(ing.children, uid);
      if (found) return found;
    }
  }
  return null;
}

export function findIngredientById(ings, id) {
  for (const ing of ings) {
    if (String(ing.id) === String(id)) return ing;
    if (ing.children && ing.children.length) {
      const found = findIngredientById(ing.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findIngredientsById(ings, id, acc = []) {
  if (!Array.isArray(ings)) return acc;
  for (const ing of ings) {
    if (String(ing.id) === String(id)) acc.push(ing);
    if (ing.children && ing.children.length) {
      findIngredientsById(ing.children, id, acc);
    }
  }
  return acc;
}

// -------------------------
// API helpers
// -------------------------

const activeControllers = new Set();

function trackController(controller) {
  activeControllers.add(controller);
  return controller;
}

export function cancelItemRequests() {
  activeControllers.forEach(c => c.abort());
  activeControllers.clear();
  if (ingredientTreeWorker) {
    ingredientTreeWorker.terminate();
    ingredientTreeWorker = null;
  }
}

export async function fetchItemData(id) {
  const controller = trackController(new AbortController());
  const cacheKey = `item_${id}`;
  const cached = getCached(cacheKey, true);
  const requestHeaders = {};
  if (cached?.etag) requestHeaders['If-None-Match'] = cached.etag;
  if (cached?.lastModified) requestHeaders['If-Modified-Since'] = cached.lastModified;

  try {
    // Intentar primero obtener los datos desde el backend para detectar nested_recipe
    try {
      const backendRes = await fetchWithCache(`/backend/api/itemBundle.php?ids=${id}`, {
        headers: requestHeaders,
        signal: controller.signal
      });
      if (backendRes.ok) {
        const payload = await backendRes.json().catch(() => null);
        const { data: responseData, meta } = normalizeApiResponse(payload);
        const entry = Array.isArray(responseData) ? responseData[0] : null;
        if (entry && entry.item) {
          const data = entry.item;
          if (entry.nested_recipe) data.nested_recipe = entry.nested_recipe;
          const etag = backendRes.headers.get('ETag');
          const lastModified = backendRes.headers.get('Last-Modified');
          const ttl = etag || lastModified ? null : undefined;
          data.lastUpdated = new Date().toISOString();
          setCached(cacheKey, data, ttl, { etag, lastModified });
          if (Array.isArray(meta?.errors) && meta.errors.length) {
            console.warn('itemBundle devolvió errores', meta.errors);
          }
          return data;
        }
        if (Array.isArray(meta?.errors) && meta.errors.length) {
          console.warn('itemBundle respondió sin datos', meta.errors);
        }
      }
    } catch (e) {
      // Ignorar y usar el fallback
    }

    const r = await fetchWithCache(`https://api.guildwars2.com/v2/items/${id}?lang=es`, {
      headers: requestHeaders,
      signal: controller.signal
    });
    if (r.status === 304 && cached) return cached.value;
    if (!r.ok) throw new Error(`Error ${r.status} obteniendo datos del ítem ${id}`);

    const data = await r.json();
    data.lastUpdated = new Date().toISOString();
    const etag = r.headers.get('ETag');
    const lastModified = r.headers.get('Last-Modified');
    const ttl = etag || lastModified ? null : undefined;
    setCached(cacheKey, data, ttl, { etag, lastModified });
    return data;
  } finally {
    activeControllers.delete(controller);
  }
}

let ingredientTreeWorker = null;

function normalizeNestedRecipeNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  let clone;
  try {
    clone = typeof structuredClone === 'function' ? structuredClone(node) : JSON.parse(JSON.stringify(node));
  } catch (err) {
    clone = { ...node };
  }
  const rawChildren = Array.isArray(clone.children)
    ? clone.children
    : Array.isArray(clone.components)
      ? clone.components
      : [];
  clone.children = rawChildren
    .map((child) => normalizeNestedRecipeNode(child))
    .filter((child) => child !== null);
  if ('components' in clone) {
    delete clone.components;
  }
  return clone;
}

function normalizeNestedRecipe(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeNestedRecipeNode(entry)).filter((entry) => entry !== null);
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.tree)) {
      return raw.tree.map((entry) => normalizeNestedRecipeNode(entry)).filter((entry) => entry !== null);
    }
    if (Array.isArray(raw.children)) {
      return raw.children.map((entry) => normalizeNestedRecipeNode(entry)).filter((entry) => entry !== null);
    }
    if (Array.isArray(raw.components)) {
      return raw.components.map((entry) => normalizeNestedRecipeNode(entry)).filter((entry) => entry !== null);
    }
    const normalized = normalizeNestedRecipeNode(raw);
    return normalized ? [normalized] : [];
  }
  return [];
}

export async function prepareIngredientTreeData(mainItemId, mainRecipeData) {
  if (!mainRecipeData || !mainRecipeData.ingredients || mainRecipeData.ingredients.length === 0) {
    runtimeWindow._mainRecipeOutputCount = mainRecipeData ? (mainRecipeData.output_item_count || 1) : 1;
    return [];
  }

  // Si el backend provee un árbol anidado, usarlo directamente
  if (mainRecipeData.nested_recipe) {
    runtimeWindow._mainRecipeOutputCount = mainRecipeData.output_item_count || 1;
    const normalizedNested = normalizeNestedRecipe(mainRecipeData.nested_recipe);
    const deserialized = normalizedNested.map(obj => createCraftIngredientFromRecipe(obj, null));
    restoreCraftIngredientPrototypes(deserialized, null);
    deserialized.forEach(root => root.recalc(runtimeWindow.globalQty, null));
    return deserialized;
  }

  // Fallback al worker si el backend no envía nested_recipe
  if (ingredientTreeWorker) {
    ingredientTreeWorker.terminate();
  }
  ingredientTreeWorker = new Worker(new URL('./workers/ingredientTreeWorker.js', import.meta.url), { type: 'module' });

  return new Promise((resolve, reject) => {
    const handleMessage = (event) => {
      ingredientTreeWorker.removeEventListener('message', handleMessage);
      ingredientTreeWorker.removeEventListener('error', handleError);
      let serialized = event.data?.tree || [];
      ingredientTreeWorker = null;
      if (!Array.isArray(serialized)) {
        if (serialized && typeof serialized === 'object') {
          serialized = Array.isArray(serialized.children) ? serialized.children : [serialized];
        } else {
          serialized = [];
        }
      }
      const deserialized = serialized.map(obj => createCraftIngredientFromRecipe(obj, null));
      restoreCraftIngredientPrototypes(deserialized, null);
      deserialized.forEach(root => root.recalc(runtimeWindow.globalQty, null));
      resolve(deserialized);
    };
    const handleError = (err) => {
      ingredientTreeWorker.removeEventListener('message', handleMessage);
      ingredientTreeWorker.removeEventListener('error', handleError);
      ingredientTreeWorker = null;
      console.error('Error en ingredientTreeWorker:', err?.message || err, err);
      const msg = `Error procesando ingredientes${err?.message ? `: ${err.message}` : ''}`;
      if (runtimeWindow.StorageUtils && typeof runtimeWindow.StorageUtils.showToast === 'function') {
        runtimeWindow.StorageUtils.showToast(msg, 'error');
      } else if (typeof alert === 'function') {
        alert(msg);
      }
      reject(err);
    };
    ingredientTreeWorker.addEventListener('message', handleMessage);
    ingredientTreeWorker.addEventListener('error', handleError);
    const guardConfig = getWorkerGuardConfig();
    ingredientTreeWorker.postMessage({ type: 'runtimeConfig', config: guardConfig });
    ingredientTreeWorker.postMessage({ type: 'generateTree', mainItemId, mainRecipeData });
  });
}

export async function fetchRecipeData(outputItemId) {
  const controller = trackController(new AbortController());
  const cacheKey = `recipe_${outputItemId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    activeControllers.delete(controller);
    return cached;
  }
  try {
    const recipeSearch = await fetchWithCache(`https://api.guildwars2.com/v2/recipes/search?output=${outputItemId}`, {
      signal: controller.signal
    });
    if (!recipeSearch.ok) return null;
    const ids = await recipeSearch.json();
    if (!ids || ids.length === 0) return null;
    const recipeId = ids[0];
    const recipeRes = await fetchWithCache(`https://api.guildwars2.com/v2/recipes/${recipeId}?lang=es`, {
      signal: controller.signal
    });
    if (!recipeRes.ok) throw new Error(`Error ${recipeRes.status} obteniendo datos de la receta ${recipeId}`);
    const recipe = await recipeRes.json();
    recipe.lastUpdated = new Date().toISOString();
    setCached(cacheKey, recipe);
    return recipe;
  } finally {
    activeControllers.delete(controller);
  }
}

export function createCraftIngredientFromRecipe(recipe, parentUid = null) {
  const ingredient = new CraftIngredient({
    id: recipe.id,
    name: recipe.name,
    icon: recipe.icon,
    rarity: recipe.rarity,
    count: recipe.count || 1,
    recipe: recipe.recipe || null,
    buy_price: recipe.buy_price || 0,
    sell_price: recipe.sell_price || 0,
    is_craftable: recipe.is_craftable || false,
    children: [],
    _parentId: parentUid
  });
  if (recipe.children && recipe.children.length > 0) {
    ingredient.children = recipe.children.map(child =>
      createCraftIngredientFromRecipe(
        structuredClone ? structuredClone(child) : JSON.parse(JSON.stringify(child)),
        ingredient._uid
      )
    );
  }
  return ingredient;
}

// -------------------------
// Comparativa helpers
// -------------------------

if (typeof window !== 'undefined') {
  if (typeof runtimeWindow.comparativa === 'undefined') {
    runtimeWindow.comparativa = {};
  }

    let comparativaUpdater = null;
    const comparativaMetaById = new Map();

    function hydrateAggregateNodeForComparativa(node, parent = null) {
      if (!node) return null;
      const ingredient = new CraftIngredient({
        id: node.id,
        name: node.name,
        icon: node.icon,
        rarity: node.rarity,
        count: Number.isFinite(Number(node.count)) ? Number(node.count) : 1,
        buy_price: Number(node.buy_price || 0),
        sell_price: Number(node.sell_price || 0),
        is_craftable: Boolean(node.is_craftable),
        recipe: node.recipe || null,
        children: [],
        _parentId: parent ? parent._uid : null,
      });
      ingredient.countTotal = Number(node.countTotal ?? ingredient.count);
      ingredient.total_buy = Number(node.total_buy || 0);
      ingredient.total_sell = Number(node.total_sell || 0);
      ingredient.total_crafted = node.total_crafted == null ? null : Number(node.total_crafted || 0);
      ingredient.crafted_price = node.crafted_price == null ? null : Number(node.crafted_price || 0);
      ingredient.mode = node.mode || 'buy';
      ingredient.modeForParentCrafted = node.modeForParentCrafted || 'buy';
      ingredient.expanded = Boolean(node.expanded);
      ingredient._parent = parent || null;
      const children = Array.isArray(node.children) ? node.children : [];
      ingredient.children = children.map(child => hydrateAggregateNodeForComparativa(child, ingredient));
      return ingredient;
    }

    function updateComparativaFreshnessBannerFromMeta() {
      if (!isFeatureEnabled('usePrecomputed')) {
        hideFreshnessBanner();
        return;
      }
      const metas = Array.from(comparativaMetaById.values()).filter(Boolean);
      if (!metas.length) {
        hideFreshnessBanner();
        return;
      }
      let latest = null;
      let stale = false;
      const warnings = new Set();
      const errors = new Set();
      metas.forEach((meta) => {
        if (!meta) return;
        if (meta.stale) stale = true;
        (meta.warnings || []).forEach((warning) => warnings.add(warning));
        (meta.errors || []).forEach((error) => errors.add(error));
        const ts = meta.lastUpdated || meta.generatedAt;
        if (ts) {
          if (!latest || new Date(ts) > new Date(latest)) {
            latest = ts;
          }
        }
      });
      renderFreshnessBanner({
        stale,
        lastUpdated: latest,
        warnings: Array.from(warnings),
        errors: Array.from(errors),
      });
    }

    function computePrecomputedTotals(qty) {
      const quantity = Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1;
      let totalBuy = 0;
      let totalSell = 0;
      let totalCrafted = 0;
      (runtimeWindow.ingredientObjs || []).forEach((ing) => {
        const buy = Number(ing?.total_buy || 0);
        const sell = Number(ing?.total_sell || 0);
        const craftedValue = ing?.total_crafted == null ? buy : Number(ing.total_crafted || 0);
        totalBuy += buy;
        totalSell += sell;
        switch (ing?.modeForParentCrafted) {
          case 'sell':
            totalCrafted += sell;
            break;
          case 'crafted':
            totalCrafted += craftedValue;
            break;
          default:
            totalCrafted += buy;
            break;
        }
      });
      return {
        totalBuy: totalBuy * quantity,
        totalSell: totalSell * quantity,
        totalCrafted: totalCrafted * quantity,
      };
    }

    function clearComparativaMeta(id) {
      if (id == null) {
        comparativaMetaById.clear();
      } else {
        comparativaMetaById.delete(Number(id));
      }
      updateComparativaFreshnessBannerFromMeta();
    }

    runtimeWindow.comparativa.getPrecomputedTotals = computePrecomputedTotals;
    runtimeWindow.comparativa.clearComparativaMeta = clearComparativaMeta;
    runtimeWindow.comparativa.updateFreshnessBanner = updateComparativaFreshnessBannerFromMeta;
    async function comparativaTick(ids) {
      const priceMap = await preloadPrices(ids);
      ids.forEach(id => {
        const data = priceMap.get(id) || {};
        const ing = findIngredientById(runtimeWindow.ingredientObjs, id);
        if (!ing) return;
        ing.buy_price = data.buy_price || 0;
        ing.sell_price = data.sell_price || 0;
        if (typeof ing.recalc === 'function') {
          ing.recalc(runtimeWindow.globalQty || 1, null);
        }
      });
      if (typeof runtimeWindow.safeRenderTable === 'function') {
        runtimeWindow.safeRenderTable();
      }
    }

    function refreshComparativaUpdater() {
      const ids = runtimeWindow.ingredientObjs ? runtimeWindow.ingredientObjs.map(obj => obj.id) : [];
      if (comparativaUpdater) {
        clearInterval(comparativaUpdater);
        comparativaUpdater = null;
      }
      if (ids.length === 0) return;
      const run = () => comparativaTick(ids);
      run();
      comparativaUpdater = setInterval(run, 60000);
    }

  runtimeWindow.comparativa.agregarItemPorId = async function(id) {
    runtimeWindow.ingredientObjs = runtimeWindow.ingredientObjs || [];
    runtimeWindow.globalQty = runtimeWindow.globalQty || 1;
    if (runtimeWindow.ingredientObjs.some(obj => obj.id == id)) return;
    const skeleton = document.getElementById('item-skeleton');
    const usePrecomputed = isFeatureEnabled('usePrecomputed');

    if (usePrecomputed) {
      if (comparativaUpdater) {
        clearInterval(comparativaUpdater);
        comparativaUpdater = null;
      }
      try {
        if (typeof runtimeWindow.showSkeleton === 'function') runtimeWindow.showSkeleton(skeleton);
        const raw = await fetchItemAggregate(id);
        const { item, market, tree, meta } = toUiModel(raw);
        if (!item) {
          if (typeof runtimeWindow.hideSkeleton === 'function') runtimeWindow.hideSkeleton(skeleton);
          runtimeWindow.showError?.('No se encontraron datos precomputados para este ítem.');
          comparativaMetaById.delete(Number(id));
          updateComparativaFreshnessBannerFromMeta();
          return;
        }

        let rootIngredient = tree ? hydrateAggregateNodeForComparativa(tree, null) : null;
        if (!rootIngredient) {
          rootIngredient = new CraftIngredient({
            id: item.id,
            name: item.name,
            icon: item.icon,
            rarity: item.rarity,
            count: 1,
            buy_price: Number(market?.unitBuyPrice || 0),
            sell_price: Number(market?.unitSellPrice || 0),
            is_craftable: false,
            recipe: null,
            children: [],
          });
          rootIngredient.total_buy = Number(market?.buy || 0);
          rootIngredient.total_sell = Number(market?.sell || 0);
          rootIngredient.total_crafted = Number(market?.crafted || 0);
        }
        if (market) {
          if (Number.isFinite(Number(market.buy))) {
            rootIngredient.total_buy = Number(market.buy);
          }
          if (Number.isFinite(Number(market.sell))) {
            rootIngredient.total_sell = Number(market.sell);
          }
          if (Number.isFinite(Number(market.crafted))) {
            rootIngredient.total_crafted = Number(market.crafted);
          }
        }

        runtimeWindow._mainRecipeOutputCount = rootIngredient?.recipe?.output_item_count
          || rootIngredient?.output
          || 1;
        runtimeWindow._mainBuyPrice = market?.unitBuyPrice ?? rootIngredient.buy_price ?? 0;
        runtimeWindow._mainSellPrice = market?.unitSellPrice ?? rootIngredient.sell_price ?? 0;

        runtimeWindow.ingredientObjs.push(rootIngredient);
        comparativaMetaById.set(Number(rootIngredient.id), meta);
        updateComparativaFreshnessBannerFromMeta();

        if (typeof runtimeWindow.safeRenderTable === 'function') {
          runtimeWindow.safeRenderTable(runtimeWindow._mainBuyPrice, runtimeWindow._mainSellPrice);
        }
        if (typeof runtimeWindow.hideSkeleton === 'function') runtimeWindow.hideSkeleton(skeleton);
      } catch (e) {
        if (typeof runtimeWindow.hideSkeleton === 'function') runtimeWindow.hideSkeleton(skeleton);
        console.error('Error agregando ítem precomputado', e);
        runtimeWindow.showError?.('No se pudo cargar el agregado del ítem.');
      }
      return;
    }

    comparativaMetaById.clear();
    hideFreshnessBanner();
    try {
      if (typeof runtimeWindow.showSkeleton === 'function') runtimeWindow.showSkeleton(skeleton);
      const itemData = await fetchItemData(id);
      const recipeData = await fetchRecipeData(id);
      const marketData = await getPrice(id);
      const hasIngredients = Array.isArray(recipeData?.ingredients) && recipeData.ingredients.length > 0;
      let ingredientesArbol;

      runtimeWindow._mainBuyPrice = marketData.buy_price || 0;
      runtimeWindow._mainSellPrice = marketData.sell_price || 0;

      if (recipeData && hasIngredients) {
        let hijos = await prepareIngredientTreeData(id, recipeData);
        if (!Array.isArray(hijos)) hijos = [];
        const treeFailed = hasIngredients && hijos.length === 0;
        if (treeFailed) {
          const toastMessage = 'No se pudo construir el árbol de ingredientes. Mostrando el ítem sin receta.';
          if (runtimeWindow.StorageUtils && typeof runtimeWindow.StorageUtils.showToast === 'function') {
            runtimeWindow.StorageUtils.showToast(toastMessage, 'error');
          } else {
            console.warn(toastMessage);
          }
        }
        runtimeWindow._mainRecipeOutputCount = recipeData.output_item_count || 1;
        ingredientesArbol = new CraftIngredient({
          id: itemData.id,
          name: itemData.name,
          icon: itemData.icon,
          rarity: itemData.rarity,
          count: 1,
          buy_price: marketData.buy_price,
          sell_price: marketData.sell_price,
          is_craftable: !treeFailed,
          recipe: treeFailed ? null : recipeData,
          children: treeFailed ? [] : hijos,
        });
        ingredientesArbol.recalc(runtimeWindow.globalQty || 1, null);
      } else {
        runtimeWindow._mainRecipeOutputCount = recipeData ? (recipeData.output_item_count || 1) : 1;
        ingredientesArbol = new CraftIngredient({
          id: itemData.id,
          name: itemData.name,
          icon: itemData.icon,
          rarity: itemData.rarity,
          count: 1,
          buy_price: marketData.buy_price,
          sell_price: marketData.sell_price,
          is_craftable: false,
          recipe: null,
          children: [],
        });
      }
      runtimeWindow.ingredientObjs.push(ingredientesArbol);
      refreshComparativaUpdater();
      if (typeof runtimeWindow.safeRenderTable === 'function') {
        if (typeof marketData.buy_price === 'number' && typeof marketData.sell_price === 'number') {
          runtimeWindow.safeRenderTable(marketData.buy_price, marketData.sell_price);
        } else {
          runtimeWindow.safeRenderTable();
        }
      }
      if (typeof runtimeWindow.hideSkeleton === 'function') runtimeWindow.hideSkeleton(skeleton);
    } catch (e) {
      if (typeof runtimeWindow.hideSkeleton === 'function') runtimeWindow.hideSkeleton(skeleton);
      alert('Error al agregar el ítem: ' + (e?.message || e));
      console.error('Error al agregar el ítem', e);
    }
  };

  runtimeWindow.comparativa.handleSaveComparativa = async function() {
    if (!runtimeWindow.ingredientObjs || runtimeWindow.ingredientObjs.length === 0) {
      runtimeWindow.StorageUtils?.showToast('Agrega al menos un ítem a la comparativa', 'error');
      return;
    }
    const ids = runtimeWindow.ingredientObjs.map(obj => obj.id);
    const nombres = runtimeWindow.ingredientObjs.map(obj => obj.name);
    const comparativa = { ids, nombres, timestamp: Date.now() };
    if (runtimeWindow.StorageUtils && typeof runtimeWindow.StorageUtils.saveComparativa === 'function') {
      await runtimeWindow.StorageUtils.saveComparativa(comparativa);
      runtimeWindow.StorageUtils.showToast('Comparativa guardada');
    } else {
      alert('StorageUtils no está disponible.');
    }
  };

  runtimeWindow.comparativa.loadComparativaFromURL = function() {
    const params = new URLSearchParams(runtimeWindow.location.search);
    const idsParam = params.get('ids');
    if (!idsParam) return;
    const ids = idsParam.split(',').map(id => parseInt(id,10)).filter(n => !isNaN(n));
    if (ids.length === 0) return;
    runtimeWindow.ingredientObjs = runtimeWindow.ingredientObjs || [];
    runtimeWindow.globalQty = runtimeWindow.globalQty || 1;
    const tryLoad = () => {
      if (runtimeWindow.comparativa && typeof runtimeWindow.comparativa.agregarItemPorId === 'function') {
        (async () => {
          const errors = [];
          for (const id of ids) {
            try {
              await runtimeWindow.comparativa.agregarItemPorId(id);
            } catch (err) {
              console.error('Error cargando ítem de la URL', id, err);
              errors.push({ id, error: err });
            }
          }
          if (errors.length > 0) {
            const message = `No se pudieron cargar ${errors.length} ítems de la URL.`;
            if (runtimeWindow.StorageUtils?.showToast) {
              runtimeWindow.StorageUtils.showToast(message, 'error');
            } else {
              alert(message);
            }
          }
        })();
      } else {
        setTimeout(tryLoad, 50);
      }
    };
    tryLoad();
  };
}

export function calcPercent(sold, available) {
  if (!sold || !available || isNaN(sold) || isNaN(available) || available === 0) return '-';
  return ((sold / available) * 100).toFixed(1) + '%';
}

// Assign to window for non-module scripts
if (typeof window !== 'undefined') {
  runtimeWindow.setIngredientObjs = setIngredientObjs;
  runtimeWindow.setGlobalQty = setGlobalQty;
  runtimeWindow.snapshotExpandState = snapshotExpandState;
  runtimeWindow.restoreExpandState = restoreExpandState;
  runtimeWindow.recalcAll = recalcAll;
  // getTotals() siempre retorna los totales globales calculados por recalcAll
  runtimeWindow.getTotals = getTotals;
  runtimeWindow.findIngredientByIdAndParent = findIngredientByIdAndParent;
  runtimeWindow.findIngredientByPath = findIngredientByPath;
  runtimeWindow.findIngredientByUid = findIngredientByUid;
  runtimeWindow.findIngredientById = findIngredientById;
  runtimeWindow.findIngredientsById = findIngredientsById;
  runtimeWindow.calcPercent = calcPercent;
}

