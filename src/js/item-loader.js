import fetchWithRetry from './utils/fetchWithRetry.js';
import { startPriceUpdater } from './utils/priceUpdater.js';
import { normalizeApiResponse } from './utils/apiResponse.js';
import { isFeatureEnabled } from './utils/featureFlags.js';
import { getConfig } from './config.js';
import { getBucket, syncAssignments as syncCanaryAssignments } from './utils/canaryBucket.js';
import { fetchItemAggregate } from './services/aggregateService.js';
import {
  toUiModel as toAggregateUiModel,
  mergePriceSummaries,
  toPriceSummary,
} from './adapters/aggregateAdapter.js';
import { toUiModel as toLegacyUiModel } from './adapters/legacyAdapter.js';
import { fromEntry as priceEntryToSummary } from './adapters/priceAdapter.js';
import { hydrateAggregateTree } from './utils/aggregateHydrator.js';
import { renderFreshnessBanner, hideFreshnessBanner } from './utils/freshnessBanner.js';
import { recordAggregateDuration, trackTelemetryEvent, now as telemetryNow } from './utils/telemetry.js';
import './utils/registerWebVitals.js';

let prepareIngredientTreeData,
  CraftIngredient,
  setIngredientObjs,
  setTotalsFromAggregate,
  findIngredientsById,
  cancelItemRequests,
  recalcAll,
  getItemBundles,
  updateState,
  preloadPrices,
  getPrice;

const runtimeGlobal = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined' ? window : undefined);

let depsPromise;
async function ensureDeps() {
  if (!depsPromise) {
    depsPromise = Promise.all([
      import('./items-core.js'),
      import('./utils/priceHelper.js'),
      import('./services/recipeService.js'),
      import('./utils/stateManager.js')
    ]).then(([core, price, recipe, state]) => {
      ({
        prepareIngredientTreeData,
        CraftIngredient,
        setIngredientObjs,
        setTotalsFromAggregate,
        findIngredientsById,
        cancelItemRequests,
        recalcAll
      } = core);
      ({ preloadPrices, getPrice } = price);
      ({ getItemBundles } = recipe);
      ({ update: updateState } = state);

      if (typeof window !== 'undefined' && !window.RecipeService) {
        console.error('Servicios de recetas no disponibles: window.RecipeService no está definido.');
      }
    });
  }
  return depsPromise;
}

let loadToken = 0;
let stopPriceUpdater = null;
let itemDetailsController = null;

function stopPriceUpdaterIfNeeded() {
  if (!stopPriceUpdater) return;
  try {
    stopPriceUpdater();
  } catch (err) {
    console.warn('Error deteniendo actualizador de precios', err);
  }
  stopPriceUpdater = null;
}

function buildItemDetailsApiUrl(baseUrl, itemId) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  const trimmedBase = base.replace(/\/+$/, '');
  const idPart = String(itemId).trim();
  const prefix = trimmedBase ? `${trimmedBase}/items` : '/items';
  return `${prefix}/${idPart}`;
}

export async function loadItems(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  await ensureDeps();
  try {
    const bundles = await getItemBundles(ids);
    return bundles;
  } catch (e) {
    console.error('Error cargando ítems', e);
    return [];
  }
}

function getAggregateFetcher() {
  const override = runtimeGlobal?.__TEST_FETCH_ITEM_AGGREGATE__;
  return typeof override === 'function' ? override : fetchItemAggregate;
}

function getFetchWithRetryImpl() {
  const override = runtimeGlobal?.__TEST_FETCH_WITH_RETRY__;
  return typeof override === 'function' ? override : fetchWithRetry;
}

function applyCanaryAssignments(meta, source = 'api-response') {
  if (!meta || typeof meta !== 'object') {
    return;
  }
  const payload = meta.canaryAssignments ?? meta.canaryAssignment ?? null;
  if (!payload) {
    return;
  }
  try {
    syncCanaryAssignments(payload, { source });
  } catch (err) {
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn('No se pudieron sincronizar las asignaciones canary desde el backend', err);
    }
  }
}

function recordAggregateFallback(reason, meta = null, error = null, bucket = null) {
  const event = {
    reason: reason || 'unknown',
    meta: meta ? { ...meta } : null,
    stale: Boolean(meta?.stale),
    error: error ? String(error?.message || error) : undefined,
    timestamp: new Date().toISOString(),
  };

  if (typeof updateState === 'function') {
    try {
      updateState('aggregate-fallback', event);
    } catch (stateErr) {
      console.warn('No se pudo registrar el fallback en el estado', stateErr);
    }
  }

  if (runtimeGlobal) {
    if (!Array.isArray(runtimeGlobal.__aggregateFallbacks__)) {
      runtimeGlobal.__aggregateFallbacks__ = [];
    }
    runtimeGlobal.__aggregateFallbacks__.push(event);
    runtimeGlobal.__lastAggregateFallback__ = event;
  }

  trackTelemetryEvent({
    type: 'aggregateFallback',
    bucket,
    meta: {
      stale: event.stale,
      reason: event.reason,
    },
    error: event.error,
  });

  return event;
}

async function loadItemUsingAggregate(itemId, skeleton, currentToken, context = {}) {
  hideFreshnessBanner();
  window.hideError?.();
  let fallbackTriggered = false;
  const { bucket = null } = context || {};
  const now = () => telemetryNow();
  const startTime = now();
  let lastMeta = null;
  const previousStopper = stopPriceUpdater;
  let previousStopperHandled = false;

  const stopPreviousPriceUpdater = () => {
    if (previousStopperHandled) return;
    previousStopperHandled = true;
    if (!previousStopper) return;
    try {
      previousStopper();
    } catch (err) {
      console.warn('Error deteniendo actualizador previo', err);
    }
    if (stopPriceUpdater === previousStopper) {
      stopPriceUpdater = null;
    }
  };

  const triggerFallback = async (reason, meta, err) => {
    if (fallbackTriggered) return;
    fallbackTriggered = true;
    const staleFlag = meta?.stale ?? lastMeta?.stale ?? null;
    stopPreviousPriceUpdater();
    stopPriceUpdaterIfNeeded();
    recordAggregateFallback(reason, meta, err, bucket);
    await loadItemLegacy(itemId, skeleton, currentToken, {
      bucket,
      fromFallback: true,
      fallbackReason: reason,
      stale: staleFlag,
    });
  };

  try {
    window.showSkeleton?.(skeleton);
    itemDetailsController = new AbortController();
    const aggregateFetcher = getAggregateFetcher();
    const response = await aggregateFetcher(itemId, {
      signal: itemDetailsController.signal,
    });
    const aggregateModel = response?.model
      || toAggregateUiModel({ data: response?.data, meta: response?.meta });
    if (response?.status === 304 && response.fromCache) {
      lastMeta = aggregateModel?.meta || response?.meta || null;
      applyCanaryAssignments(lastMeta, 'aggregate-cache');
      window.hideSkeleton?.(skeleton);
      renderFreshnessBanner(aggregateModel?.meta);
      trackTelemetryEvent({
        type: 'aggregateNotModified',
        bucket,
        meta: { stale: aggregateModel?.meta?.stale ?? null },
      });
      return;
    }
    stopPreviousPriceUpdater();
    stopPriceUpdaterIfNeeded();
    const { item, market, tree, meta, prices } = aggregateModel;
    lastMeta = meta || null;
    applyCanaryAssignments(meta, 'aggregate');
    if (currentToken !== loadToken) return;

    if (!item) {
      await triggerFallback('missing-item', meta);
      return;
    }

    const metaErrors = Array.isArray(meta?.errors) ? meta.errors.filter(Boolean) : [];
    if (metaErrors.length) {
      await triggerFallback('meta-errors', meta);
      return;
    }

    const rootIngredient = hydrateAggregateTree(tree);
    const ingredientList = rootIngredient ? [rootIngredient] : [];
    setIngredientObjs(ingredientList);
    const priceSummary = prices?.hasData ? prices : toPriceSummary(market);
    const totals = {
      buy: priceSummary?.totals?.buy ?? market?.buy ?? null,
      sell: priceSummary?.totals?.sell ?? market?.sell ?? null,
      crafted: priceSummary?.totals?.crafted ?? market?.crafted ?? null,
    };
    setTotalsFromAggregate(totals);

    const unitBuy = priceSummary?.unit?.buy ?? rootIngredient?.buy_price ?? 0;
    const unitSell = priceSummary?.unit?.sell ?? rootIngredient?.sell_price ?? 0;
    window._mainBuyPrice = unitBuy || 0;
    window._mainSellPrice = unitSell || 0;
    window._mainRecipeOutputCount = rootIngredient?.recipe?.output_item_count
      || rootIngredient?.output
      || 1;

    await window.initItemUI(item, {
      buy_price: window._mainBuyPrice,
      sell_price: window._mainSellPrice,
    });
    await window.safeRenderTable?.();
    window.hideSkeleton?.(skeleton);
    renderFreshnessBanner(meta);

    const duration = now() - startTime;
    recordAggregateDuration({
      bucket,
      stale: meta?.stale ?? null,
      duration,
    });
    trackTelemetryEvent({
      type: 'aggregateSuccess',
      bucket,
      metrics: {
        durationMs: duration,
      },
      meta: {
        stale: meta?.stale ?? null,
      },
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return;
    }
    stopPreviousPriceUpdater();
    window.hideSkeleton?.(skeleton);
    console.error('Error cargando agregado de ítem', err);
    window.showError?.('No se pudo cargar el agregado del ítem.');
    hideFreshnessBanner();
    if (currentToken !== loadToken) return;
    trackTelemetryEvent({
      type: 'aggregateError',
      bucket,
      meta: {
        stale: lastMeta?.stale ?? null,
      },
      error: String(err?.message || err),
    });
    await triggerFallback('aggregate-error', lastMeta, err);
  }
}

export async function loadItemLegacy(itemId, skeleton, currentToken, context = {}) {
  await ensureDeps();
  hideFreshnessBanner();
  window.hideError?.();
  let rootIngredient = null;
  let marketData = null;

  const fetchImpl = getFetchWithRetryImpl();
  const {
    bucket = null,
    fromFallback = false,
    fallbackReason = null,
    stale: staleFromAggregate = null,
  } = context || {};

  trackTelemetryEvent({
    type: 'legacyLoadStart',
    bucket,
    meta: {
      fromFallback: Boolean(fromFallback),
      fallbackReason,
      aggregateStale: staleFromAggregate,
    },
  });

  try {
    window.showSkeleton?.(skeleton);
    itemDetailsController = new AbortController();
    const { API_BASE_URL, FEATURE_ITEM_API_ROLLOUT } = getConfig();
    const shouldUseItemApi = Boolean(FEATURE_ITEM_API_ROLLOUT);
    let response = null;
    let raw = null;

    if (shouldUseItemApi) {
      const apiUrl = buildItemDetailsApiUrl(API_BASE_URL, itemId);
      try {
        const apiResponse = await fetchImpl(apiUrl, {
          signal: itemDetailsController.signal
        });
        if (apiResponse.status === 404) {
          console.warn('Item API devolvió 404, usando fallback PHP');
        } else if (!apiResponse.ok) {
          throw new Error(`Error ${apiResponse.status} obteniendo detalles del ítem desde API`);
        } else {
          const apiContentType = apiResponse.headers.get('content-type') || '';
          if (!apiContentType.includes('application/json')) {
            throw new Error(`Respuesta no válida: ${apiContentType}`);
          }
          const parsed = await apiResponse.json().catch(() => null);
          if (!parsed) {
            throw new Error('Payload JSON no válido en item API');
          }
          response = apiResponse;
          raw = parsed;
        }
      } catch (apiErr) {
        if (apiErr?.name === 'AbortError') {
          throw apiErr;
        }
        console.warn('Fallo en item API, usando PHP como fallback', apiErr);
        response = null;
        raw = null;
      }
    }

    if (!response) {
      response = await fetchImpl(`/backend/api/itemDetails.php?itemId=${itemId}`, {
        signal: itemDetailsController.signal
      });
      if (response.status === 404) {
        window.showError?.('El ítem no existe');
        window.hideSkeleton?.(skeleton);
        return;
      }
      if (!response.ok) throw new Error(`Error ${response.status} obteniendo detalles del ítem`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Respuesta no válida: ${contentType}`);
      }
      raw = await response.json().catch(() => null);
    }

    const { data, meta } = normalizeApiResponse(raw);
    applyCanaryAssignments(meta, 'legacy');
    const legacyModel = toLegacyUiModel({ data, meta });
    trackTelemetryEvent({
      type: 'legacyLoad',
      bucket,
      meta: {
        stale: legacyModel?.meta?.stale ?? null,
        fromFallback: Boolean(fromFallback),
        fallbackReason,
      },
    });
    const item = legacyModel.item;
    const recipe = legacyModel.primaryRecipe;
    const nestedRecipe = legacyModel.nestedRecipe;

    if (!item) {
      const errorMessage = legacyModel?.meta?.errors?.[0] || meta?.errors?.[0] || 'El ítem no existe';
      window.showError?.(errorMessage);
      window.hideSkeleton?.(skeleton);
      return;
    }
    if (currentToken !== loadToken) return;

    // El skeleton se ocultará tras renderizar la UI
    const baseMarket = Array.isArray(legacyModel.market) || !legacyModel.market
      ? {}
      : { ...legacyModel.market };
    let priceSummary = legacyModel.prices;
    if (!priceSummary?.hasData) {
      try {
        const fallbackPrice = await getPrice(itemId);
        if (fallbackPrice) {
          const fallbackSummary = priceEntryToSummary(fallbackPrice);
          priceSummary = mergePriceSummaries(priceSummary, fallbackSummary);
        }
      } catch (priceErr) {
        console.warn('No se pudo recuperar el precio de respaldo', priceErr);
      }
    }
    const ensuredSummary = priceSummary?.hasData ? priceSummary : toPriceSummary(baseMarket);
    marketData = {
      ...baseMarket,
      buy_price: ensuredSummary?.unit?.buy ?? baseMarket.buy_price ?? 0,
      sell_price: ensuredSummary?.unit?.sell ?? baseMarket.sell_price ?? 0,
    };
    window._mainBuyPrice = marketData.buy_price ?? 0;
    window._mainSellPrice = marketData.sell_price ?? 0;

    if (!recipe) {
      setIngredientObjs([]);
      window.initItemUI(item, marketData);
      return;
    }

    if (recipe && nestedRecipe) {
      recipe.nested_recipe = nestedRecipe;
    }
    window._mainRecipeOutputCount = recipe.output_item_count || 1;

    setTimeout(async () => {
      if (currentToken !== loadToken) return;
      let children;
      try {
        children = await prepareIngredientTreeData(itemId, recipe);
      } catch (err) {
        console.error('Error preparando ingredientes', err);
        window.showError?.('Error al preparar los ingredientes');
        setIngredientObjs([]);
        window.initItemUI(item, marketData);
        return;
      }
      if (!Array.isArray(children)) children = [];
      const recipeHasIngredients = Array.isArray(recipe?.ingredients) && recipe.ingredients.length > 0;
      const treeFailed = recipeHasIngredients && children.length === 0;
      let treeFailureUiMessage = null;
      if (treeFailed) {
        const toastMessage = 'No se pudo construir el árbol de ingredientes. Mostrando el ítem sin receta.';
        treeFailureUiMessage = 'Sin receta disponible (no se pudo procesar la receta).';
        if (window.StorageUtils && typeof window.StorageUtils.showToast === 'function') {
          window.StorageUtils.showToast(toastMessage, 'error');
        } else {
          console.warn(toastMessage);
        }
      }
      rootIngredient = new CraftIngredient({
        id: item.id,
        name: item.name,
        icon: item.icon,
        rarity: item.rarity,
        count: 1,
        buy_price: marketData?.buy_price || 0,
        sell_price: marketData?.sell_price || 0,
        is_craftable: !treeFailed,
        recipe: treeFailed ? null : recipe,
        children: treeFailed ? [] : children
      });
      rootIngredient.recalc(window.globalQty || 1, null);
      setIngredientObjs([rootIngredient]);
      await window.initItemUI(item, marketData);
      await window.safeRenderTable?.();
      if (treeFailureUiMessage) {
        window.showError?.(treeFailureUiMessage);
      }

      function collectIds(node, acc) {
        acc.add(node.id);
        if (node.children) node.children.forEach(child => collectIds(child, acc));
      }
      const allIds = new Set();
      collectIds(rootIngredient, allIds);

      if (stopPriceUpdater) stopPriceUpdater();
      const idsArray = Array.from(allIds);
      const applyPrices = async (priceMap) => {
        if (!document.getElementById('seccion-crafting')) {
          requestAnimationFrame(() => applyPrices(priceMap));
          return;
        }
        const updatedNodes = [];
        priceMap.forEach((data, id) => {
          const ings = findIngredientsById(window.ingredientObjs, Number(id));
          if (!ings.length) return;
          ings.forEach(ing => {
            ing.buy_price = data.buy_price || 0;
            ing.sell_price = data.sell_price || 0;
            if (ing === window.ingredientObjs[0]) {
              window._mainBuyPrice = ing.buy_price;
              window._mainSellPrice = ing.sell_price;
            }
            updatedNodes.push(ing);
          });
        });
        await window.safeRenderTable?.();
        const totals = window.getTotals?.();
        if (totals) {
          updateState('totales-crafting-global', totals);
          updateState('totales-crafting-unit', totals);
        }
        updatedNodes.forEach(ing => updateState(ing._uid, ing));
      };
      stopPriceUpdater = startPriceUpdater(idsArray, applyPrices);
    }, 0);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Error cargando ítem', err);
    window.showError?.('Error al cargar los datos del ítem');
    window.hideSkeleton?.(skeleton);
    trackTelemetryEvent({
      type: 'legacyError',
      bucket,
      meta: {
        fromFallback: Boolean(fromFallback),
        fallbackReason,
      },
      error: String(err?.message || err),
    });
  } finally {
    itemDetailsController = null;
  }
}

export async function loadItem(itemId, options = {}) {
  await ensureDeps();
  const currentToken = ++loadToken;
  if (itemDetailsController) {
    itemDetailsController.abort();
    itemDetailsController = null;
  }
  cancelItemRequests();

  if (!itemId) {
    window.hideSkeleton?.(document.getElementById('item-skeleton'));
    window.showError?.('ID de ítem no válido');
    return;
  }

  const skeleton = document.getElementById('item-skeleton');
  const usePrecomputed = isFeatureEnabled('usePrecomputed');
  const { PRECOMPUTED_CANARY_THRESHOLD } = getConfig();
  const bucket = getBucket();
  const isCanary = bucket < PRECOMPUTED_CANARY_THRESHOLD;
  const forceLegacy = options?.forceLegacy === true;

  if (usePrecomputed && isCanary && !forceLegacy) {
    await loadItemUsingAggregate(itemId, skeleton, currentToken, { bucket });
    return;
  }

  await loadItemLegacy(itemId, skeleton, currentToken, {
    bucket,
    fromFallback: Boolean(forceLegacy),
  });
}

// Cargar datos y preparar la UI al iniciar la página
document.addEventListener('DOMContentLoaded', () => {
  const start = () => {
    const params = new URLSearchParams(window.location.search);
    const itemId = parseInt(params.get('id'), 10);
    if (itemId) {
      loadItem(itemId);
    } else {
      window.showError?.('ID de ítem no válido');
    }
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(start);
  } else {
    setTimeout(start, 0);
  }
});
