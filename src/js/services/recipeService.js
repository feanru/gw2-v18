// Servicio para manejar las llamadas a la API de recetas v2

import { getCached, setCached } from '../utils/cache.js';
import { fetchWithCache } from '../utils/requestCache.js';
import fetchWithRetry from '../utils/fetchWithRetry.js';
import { getPrice, preloadPrices } from '../utils/priceHelper.js';
import { getConfig } from '../config.js';
import { normalizeApiResponse } from '../utils/apiResponse.js';
import { toUiModel as toRecipeUiModel } from '../adapters/recipeAdapter.js';
import { fromEntry as priceEntryToSummary } from '../adapters/priceAdapter.js';
import { prepareLangRequest, getActiveLanguage } from './langContext.js';

const MAX_BUNDLE_BATCH = 35;

function buildBundleCacheKey(id, lang) {
    const normalizedLang = typeof lang === 'string' && lang ? lang : getActiveLanguage();
    return `bundle_${normalizedLang}_${id}`;
}

function buildBundleGlobalKey(id) {
    return `bundle_${id}`;
}

function buildRecipeCacheKey(id, lang) {
    const normalizedLang = typeof lang === 'string' && lang ? lang : getActiveLanguage();
    return `recipe_${normalizedLang}_${id}`;
}

function recordBundleFallback(ids, error) {
    if (typeof window === 'undefined' || !window) {
        return;
    }

    if (!Array.isArray(window.__bundleFallbacks__)) {
        window.__bundleFallbacks__ = [];
    }

    const description = error && error.message ? error.message : String(error || '') || 'unknown';

    const payload = {
        ids: Array.isArray(ids) ? ids.map(id => String(id)) : [],
        message: description,
        timestamp: new Date().toISOString()
    };

    window.__bundleFallbacks__.push(payload);
    if (window.__bundleFallbacks__.length > 50) {
        window.__bundleFallbacks__.shift();
    }
    window.__lastBundleFallback__ = payload;
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

function applyBundleEntries(payload, results, lang) {
    const { data, meta } = normalizeApiResponse(payload);
    const entries = Array.isArray(data) ? data : [];
    if (!Array.isArray(data) && Array.isArray(meta?.errors) && meta.errors.length) {
        console.warn('dataBundle devolvió errores', meta.errors);
    }
    if (entries.length) {
        entries.forEach(entry => {
            const entryKey = String(entry.id);
            const bundleCacheKey = buildBundleCacheKey(entryKey, lang);
            const bundleGlobalKey = buildBundleGlobalKey(entryKey);
            const adapters = {
                recipe: toRecipeUiModel({ data: entry?.recipe ?? null }),
                prices: priceEntryToSummary(entry?.market ?? null)
            };
            const normalizedEntry = { ...entry, adapters };
            results.set(entryKey, normalizedEntry);
            setCached(bundleCacheKey, normalizedEntry, undefined, { lang });
            setCached(bundleGlobalKey, normalizedEntry, undefined, { lang });
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('bundleItemRefreshed', { detail: normalizedEntry }));
            }
        });
    }
    return entries.length > 0;
}

/**
 * Obtiene un paquete combinado de ítem, receta y mercado para múltiples IDs
 * @param {number[]} ids - Lista de IDs de ítems
 * @returns {Promise<Array>} - Datos por ítem en el mismo orden recibido
 */
export async function getItemBundles(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const lang = getActiveLanguage();
    const results = new Map();
    const toFetch = [];

    ids.forEach(id => {
        const key = String(id);
        const primaryKey = buildBundleCacheKey(key, lang);
        let cached = getCached(primaryKey);
        if (!cached) {
            const fallbackEntry = getCached(buildBundleGlobalKey(key), true);
            if (fallbackEntry && (!fallbackEntry.lang || fallbackEntry.lang === lang)) {
                cached = fallbackEntry.value;
                if (cached) {
                    setCached(primaryKey, cached, undefined, { lang });
                }
            }
        }
        if (cached) {
            results.set(key, cached);
        } else {
            toFetch.push(key);
        }
    });

    if (toFetch.length > 0) {
        const { API_BASE_URL, FEATURE_ITEM_API_ROLLOUT } = getConfig();
        const shouldUseItemApi = Boolean(FEATURE_ITEM_API_ROLLOUT);

        for (let i = 0; i < toFetch.length; i += MAX_BUNDLE_BATCH) {
            const batch = toFetch.slice(i, i + MAX_BUNDLE_BATCH);
            const params = batch.map(id => `ids[]=${id}`).join('&');
            let apiBundleSucceeded = false;

            if (shouldUseItemApi) {
                const { url: apiUrl, options: apiOptions } = prepareLangRequest(
                    `${joinApiPath(API_BASE_URL, '/items/bundle')}?${params}`
                );
                try {
                    const response = await fetchWithRetry(apiUrl, apiOptions);
                    if (!response.ok) {
                        throw new Error(`Respuesta ${response.status} inválida en bundle API`);
                    }
                    const payload = await response.json().catch(() => null);
                    if (!payload) {
                        throw new Error('Payload JSON no válido en bundle API');
                    }
                    applyBundleEntries(payload, results, lang);
                    apiBundleSucceeded = true;
                } catch (err) {
                    apiBundleSucceeded = false;
                    console.warn('Fallo en bundle API, usando PHP como fallback', err);
                    recordBundleFallback(batch, err);
                }
            }

            if (!shouldUseItemApi || !apiBundleSucceeded) {
                try {
                    const { url: phpUrl, options: phpOptions } = prepareLangRequest(
                        `/backend/api/dataBundle.php?${params}`
                    );
                    const response = await fetchWithRetry(phpUrl, phpOptions);
                    if (!response.ok) {
                        console.error('Error en getItemBundles: respuesta no válida');
                    } else {
                        const payload = await response.json().catch(() => null);
                        applyBundleEntries(payload, results, lang);
                    }
                } catch (e) {
                    console.error('Error en getItemBundles:', e);
                }
            }

            batch.forEach(id => {
                const key = String(id);
                if (!results.has(key)) {
                    results.set(key, null);
                }
            });
        }
    }

    return ids.map(id => {
        const key = String(id);
        return results.get(key) || null;
    });
}

/**
 * Obtiene las recetas para un ítem específico
 * @param {number} itemId - ID del ítem
 * @returns {Promise<Array>} - Lista de recetas
 */
export async function getRecipesForItem(itemId) {
    const ids = Array.isArray(itemId) ? itemId : [itemId];
    const bundles = await getItemBundles(ids);
    if (Array.isArray(itemId)) {
        return bundles.map(b => (b?.recipe ? [b.recipe] : []));
    }
    const recipe = bundles[0]?.recipe;
    return recipe ? [recipe] : [];
}

/**
 * Obtiene los detalles de una receta específica
 * @param {number} recipeId - ID de la receta
 * @returns {Promise<Object>} - Detalles de la receta
 */
export async function getRecipeDetails(recipeId) {
    const lang = getActiveLanguage();
    const cacheKey = buildRecipeCacheKey(recipeId, lang);
    const cached = getCached(cacheKey, true);

    try {
        const { API_BASE_URL } = getConfig();
        const { url, options } = prepareLangRequest(`${API_BASE_URL}/recipes/${recipeId}`);
        const response = await fetchWithCache(url, options, cacheKey, cached);
        if (!response.ok) {
            return null;
        }

        const recipe = await response.json();
        if (!recipe) {
            return null;
        }
        recipe.lastUpdated = new Date().toISOString();
        const etag = response.headers.get('ETag');
        const lastModified = response.headers.get('Last-Modified');
        setCached(cacheKey, recipe, undefined, { etag, lastModified, lang });
        return recipe;
    } catch (error) {
        console.error('Error en getRecipeDetails:', error);
        return null;
    }
}

/**
 * Obtiene información detallada de un ítem
 * @param {number} itemId - ID del ítem
 * @returns {Promise<Object>} - Información del ítem
 */
export async function getItemDetails(itemId) {
    if (Array.isArray(itemId)) {
        const bundles = await getItemBundles(itemId);
        return bundles.map(b => b?.item || null);
    }
    const bundle = await getItemBundles([itemId]);
    return bundle[0]?.item || null;
}

/**
 * Obtiene los precios de un ítem usando la API CSV
 * @param {number} itemId - ID del ítem
 * @returns {Promise<Object>} - Precios de compra y venta
 */
export async function getItemPrices(itemId) {
    if (Array.isArray(itemId)) {
        const map = await preloadPrices(itemId);
        return itemId.map(id => {
            const p = map.get(id) || {};
            return { buys: { unit_price: p.buy_price || 0 }, sells: { unit_price: p.sell_price || 0 } };
        });
    }
    const p = await getPrice(itemId);
    return { buys: { unit_price: p?.buy_price || 0 }, sells: { unit_price: p?.sell_price || 0 } };
}

const recipeServiceApi = {
    getItemBundles,
    getRecipesForItem,
    getRecipeDetails,
    getItemDetails,
    getItemPrices
};

export function registerRecipeServiceGlobals(target = typeof window !== 'undefined' ? window : undefined) {
    if (!target) {
        return recipeServiceApi;
    }

    const mergedService = {
        ...(target.RecipeService || {}),
        ...recipeServiceApi
    };

    target.RecipeService = mergedService;

    Object.entries(recipeServiceApi).forEach(([name, fn]) => {
        if (typeof target[name] !== 'function') {
            target[name] = fn;
        }
    });

    return mergedService;
}

if (typeof window !== 'undefined') {
    registerRecipeServiceGlobals(window);
}
