'use strict';

const { URL } = require('url');
const { getItemIconPlaceholderPath } = require('../../../src/js/utils/iconPlaceholder.js');

const ITEM_ICON_PLACEHOLDER = getItemIconPlaceholderPath();

class TimeoutExceededError extends Error {}

function env(key, defaultValue = null) {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  return raw;
}

function envInt(key, defaultValue) {
  const raw = env(key);
  if (raw === null || raw === undefined || raw === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function envBool(key, defaultValue = false) {
  const raw = env(key);
  if (raw === null || raw === undefined || raw === '') {
    return defaultValue;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.replace(/\/+$/, '') : value;
}

function createConfig(overrides = {}) {
  const defaultLang = env('DEFAULT_LANG', 'es') || 'es';
  const fetchTimeoutMs = envInt('FETCH_TIMEOUT_MS', 15000);
  const apiBase = trimTrailingSlash(env('API_BASE_URL', 'https://api.guildwars2.com/v2'));
  const recipesEndpoint = `${apiBase}/recipes`;
  const itemsEndpoint = `${apiBase}/items`;
  const config = {
    defaultLang,
    cacheTtlFast: envInt('CACHE_TTL_FAST', 120),
    cacheTtlSlow: envInt('CACHE_TTL_SLOW', 1800),
    fetchTimeoutMs,
    maxAggregationMs: envInt('MAX_AGGREGATION_MS', 12000),
    itemsEndpoint,
    recipesEndpoint,
    recipesSearchEndpoint: `${recipesEndpoint}/search`,
    marketCsvUrl: env('MARKET_CSV_URL', 'https://api.datawars2.ie/gw2/v1/items/csv'),
    recipeTreeEndpoint: env('RECIPE_TREE_ENDPOINT', 'http://localhost/backend/api/recipeTree.js'),
    featureFlags: {
      usePrecomputed: envBool('FEATURE_USE_PRECOMPUTED', false),
      forceLocalOnly: envBool('FEATURE_FORCE_LOCAL_ONLY', false),
    },
  };

  return {
    ...config,
    ...overrides,
    featureFlags: {
      ...config.featureFlags,
      ...(overrides.featureFlags || {}),
    },
  };
}

function defaultNormalizeLang(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized || fallback;
}

function createDefaultFetch() {
  if (typeof global.fetch === 'function') {
    return global.fetch.bind(global);
  }
  let fetchPromise = null;
  return (...args) => {
    if (!fetchPromise) {
      fetchPromise = import('node-fetch').then(({ default: fetchFn }) => fetchFn);
    }
    return fetchPromise.then((fetchFn) => fetchFn(...args));
  };
}

function normalizeIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  const normalized = [];
  for (const value of ids) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    if (parsed <= 0) {
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

function parseNumericParamList(searchParams, baseKey) {
  if (!searchParams) {
    return [];
  }
  const values = [];
  for (const [key, rawValue] of searchParams.entries()) {
    if (key === baseKey || key === `${baseKey}[]` || key.startsWith(`${baseKey}[`)) {
      const chunks = String(rawValue)
        .split(',')
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk !== '');
      for (const chunk of chunks) {
        const parsed = Number.parseInt(chunk, 10);
        if (Number.isFinite(parsed)) {
          values.push(parsed);
        }
      }
    }
  }
  return normalizeIds(values);
}

function normalizeFlagKey(key) {
  if (!key) {
    return null;
  }
  const normalized = String(key)
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, '');
  if (normalized === 'useprecomputed' || normalized === 'featureuseprecomputed') {
    return 'usePrecomputed';
  }
  if (normalized === 'forcelocalonly' || normalized === 'featureforcelocalonly') {
    return 'forceLocalOnly';
  }
  return null;
}

function toBool(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value === 1;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') {
    return null;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function parseFlagOverrides(raw) {
  const overrides = {};
  if (raw == null) {
    return overrides;
  }

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const nested = parseFlagOverrides(entry);
      Object.assign(overrides, nested);
    }
    return overrides;
  }

  if (typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = normalizeFlagKey(key);
      if (!normalizedKey) {
        continue;
      }
      const bool = toBool(value);
      if (bool === null) {
        continue;
      }
      overrides[normalizedKey] = bool;
    }
    return overrides;
  }

  const rawString = String(raw);
  const segments = rawString.split(',');
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    let key = trimmed;
    let value = 'true';
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      key = parts[0];
      value = parts[1];
    } else if (trimmed.includes('=')) {
      const parts = trimmed.split('=');
      key = parts[0];
      value = parts[1];
    }
    const normalizedKey = normalizeFlagKey(key);
    if (!normalizedKey) {
      continue;
    }
    const bool = toBool(value);
    if (bool === null) {
      continue;
    }
    overrides[normalizedKey] = bool;
  }
  return overrides;
}

function resolveFeatureFlags(searchParams, defaults) {
  const flags = { ...defaults };
  if (!searchParams) {
    return flags;
  }

  const overrides = {};
  for (const [key, value] of searchParams.entries()) {
    if (key === 'ff' || key === 'ff[]') {
      Object.assign(overrides, parseFlagOverrides(value));
      continue;
    }
    if (key.startsWith('ff[') && key.endsWith(']')) {
      const innerKey = key.slice(3, -1);
      const normalizedKey = normalizeFlagKey(innerKey);
      if (!normalizedKey) {
        continue;
      }
      const bool = toBool(value);
      if (bool === null) {
        continue;
      }
      overrides[normalizedKey] = bool;
    }
  }

  return { ...flags, ...overrides };
}

function parseMarketCsv(csv) {
  if (csv == null) {
    return {};
  }
  const trimmed = String(csv).trim();
  if (!trimmed) {
    return {};
  }
  const lines = trimmed.split('\n').map((line) => line.trim());
  if (lines.length < 2) {
    return {};
  }
  const headers = lines[0] ? lines[0].split(',').map((value) => value.trim()) : [];
  const values = lines[1] ? lines[1].split(',') : [];
  const result = {};
  headers.forEach((header, index) => {
    if (!header) {
      return;
    }
    const rawValue = values[index];
    if (rawValue === undefined) {
      result[header] = null;
      return;
    }
    const numeric = Number(rawValue);
    if (!Number.isNaN(numeric)) {
      result[header] = rawValue.includes('.') ? numeric : Number.parseInt(rawValue, 10);
    } else {
      result[header] = rawValue;
    }
  });
  return result;
}

function parseMarketBundleCsv(csv) {
  if (csv == null) {
    return {};
  }
  const trimmed = String(csv).trim();
  if (!trimmed) {
    return {};
  }
  const lines = trimmed.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length < 2) {
    return {};
  }
  const headers = lines[0] ? lines[0].split(',').map((value) => value.trim()) : [];
  const results = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const values = line.split(',');
    const row = {};
    headers.forEach((header, index) => {
      if (!header) {
        return;
      }
      const rawValue = values[index];
      if (rawValue === undefined) {
        row[header] = null;
        return;
      }
      const numeric = Number(rawValue);
      if (!Number.isNaN(numeric)) {
        row[header] = rawValue.includes('.') ? numeric : Number.parseInt(rawValue, 10);
      } else {
        row[header] = rawValue;
      }
    });
    if (row.id != null) {
      const id = Number.parseInt(row.id, 10);
      if (Number.isFinite(id)) {
        row.id = id;
        results[id] = row;
      }
    }
  }
  return results;
}

function recipeMinFromData(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    return null;
  }
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
        .map((ingredient) => {
          if (!ingredient || typeof ingredient !== 'object') {
            return null;
          }
          const itemId = Number.parseInt(ingredient.item_id, 10);
          const count = Number.parseInt(ingredient.count, 10);
          if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(count) || count <= 0) {
            return null;
          }
          return {
            item_id: itemId,
            count,
          };
        })
        .filter((entry) => entry !== null)
    : [];
  return {
    id: recipe.id ?? null,
    output_item_count: Number.isFinite(recipe.output_item_count)
      ? recipe.output_item_count
      : Number.isFinite(Number(recipe.output_item_count))
        ? Number(recipe.output_item_count)
        : 1,
    ingredients,
  };
}

async function fetchWithTimeout(fetchFn, url, options, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const mergedOptions = { ...(options || {}) };
  let timeoutId = null;
  if (controller && !mergedOptions.signal && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    mergedOptions.signal = controller.signal;
    timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch (error) {
        // ignore abort issues
      }
    }, timeoutMs);
  }
  try {
    return await fetchFn(url, mergedOptions);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

async function multiFetch(requests, fetchFn, timeoutMs) {
  const entries = Object.entries(requests || {});
  if (entries.length === 0) {
    return {};
  }
  const results = {};
  await Promise.all(
    entries.map(async ([key, request]) => {
      try {
        const response = await fetchWithTimeout(fetchFn, request.url, request.options, timeoutMs);
        const status = response && typeof response.status === 'number' ? response.status : 0;
        let data = null;
        if (status === 200) {
          data = await response.text();
        }
        results[key] = { status, data };
      } catch (error) {
        results[key] = { status: 0, data: null, error };
      }
    }),
  );
  return results;
}

async function fetchJsonResource(fetchFn, url, timeoutMs) {
  try {
    const response = await fetchWithTimeout(fetchFn, url, {}, timeoutMs);
    const status = response && typeof response.status === 'number' ? response.status : 0;
    if (status !== 200) {
      return { status, data: null };
    }
    const text = await response.text();
    if (!text) {
      return { status, data: null };
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'data' in parsed && 'meta' in parsed) {
        return { status, data: parsed.data };
      }
      return { status, data: parsed };
    } catch (error) {
      return { status, data: null };
    }
  } catch (error) {
    return { status: 0, data: null, error };
  }
}

function withTimeout(asyncFn, timeoutMs) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  return Promise.resolve()
    .then(() => {
      const guard = () => {
        if (Number.isFinite(deadline) && Date.now() >= deadline) {
          throw new TimeoutExceededError('Aggregation timeout exceeded');
        }
      };
      return asyncFn(guard);
    })
    .then((data) => ({ data, stale: false }))
    .catch((error) => {
      if (error instanceof TimeoutExceededError) {
        return { data: null, stale: true };
      }
      throw error;
    });
}

function buildItemInvalidationInstructions(itemId) {
  const id = Number.parseInt(itemId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return [];
  }
  return [
    { type: 'key', value: `item_${id}` },
    { type: 'key', value: `item_${id}_en` },
    { type: 'key', value: `recipe_search_${id}` },
    { type: 'key', value: `recipe_${id}` },
    { type: 'key', value: `market_${id}` },
    { type: 'key', value: `nested_recipe_${id}` },
    { type: 'multi', prefix: 'items', id },
    { type: 'multi', prefix: 'items_en', id },
    { type: 'multi', prefix: 'market', id },
  ];
}

function buildBundleInvalidationInstructions(ids) {
  const instructions = [];
  for (const id of ids) {
    instructions.push(...buildItemInvalidationInstructions(id));
  }
  return instructions;
}

function createLegacyHandlers(deps = {}) {
  if (typeof deps.ok !== 'function') {
    throw new Error('Legacy handlers require an ok(response, data, meta, options) helper');
  }
  if (typeof deps.fail !== 'function') {
    throw new Error('Legacy handlers require a fail(response, status, code, msg, meta, ...errors) helper');
  }

  const config = createConfig(deps.config || {});
  const fetchImpl = deps.fetchImpl || createDefaultFetch();
  const logger = deps.logger || console;
  const normalizeLang = typeof deps.normalizeLang === 'function'
    ? (value) => deps.normalizeLang(value)
    : (value) => defaultNormalizeLang(value, config.defaultLang);
  const invalidateCache = typeof deps.invalidateCache === 'function' ? deps.invalidateCache : null;

  async function handleItemDetails(_req, res, context = {}) {
    const url = context.url instanceof URL ? context.url : new URL(context.url || '/', 'http://localhost');
    const lang = context.lang ? normalizeLang(context.lang) : normalizeLang(url.searchParams.get('lang'));
    const rawItemId = url.searchParams.get('itemId');
    const itemId = Number.parseInt(rawItemId, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      deps.fail(res, 400, 'item_id_required', 'itemId required', {
        lang,
        source: 'local',
        stale: false,
      });
      return;
    }

    if (invalidateCache) {
      const instructions = buildItemInvalidationInstructions(itemId);
      try {
        invalidateCache(instructions);
      } catch (error) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[legacy] failed to invalidate caches for item ${itemId}: ${error.message}`);
        }
      }
    }

    let source = 'local';
    try {
      const flags = resolveFeatureFlags(url.searchParams, config.featureFlags);
      source = flags.forceLocalOnly ? 'local' : 'fallback';
      if (flags.usePrecomputed) {
        source = 'fallback';
      }

      const aggregation = await withTimeout(
        async (guard) => {
          guard();
          const requests = {
            item: {
              url: `${config.itemsEndpoint}/${itemId}?lang=${lang}`,
            },
            item_en: {
              url: `${config.itemsEndpoint}/${itemId}?lang=en`,
            },
            recipe_search: {
              url: `${config.recipesSearchEndpoint}?output=${itemId}`,
            },
            market: {
              url: `${config.marketCsvUrl}?fields=id,buy_price,sell_price,buy_quantity,sell_quantity,last_updated,1d_buy_sold,1d_sell_sold,2d_buy_sold,2d_sell_sold,7d_buy_sold,7d_sell_sold,1m_buy_sold,1m_sell_sold&ids=${itemId}`,
            },
          };

          const responses = await multiFetch(requests, fetchImpl, config.fetchTimeoutMs);
          guard();

          const itemResponse = responses.item || { status: 0, data: null };
          let item = null;
          if (itemResponse.status === 200 && itemResponse.data) {
            try {
              const parsed = JSON.parse(itemResponse.data);
              if (parsed && typeof parsed === 'object') {
                item = parsed;
              }
            } catch (error) {
              if (logger && typeof logger.warn === 'function') {
                logger.warn(`[legacy] invalid item JSON for ${itemId}: ${error.message}`);
              }
            }
          }

          if (!item) {
            const notFound = itemResponse.status === 404;
            return {
              status: notFound ? 404 : 502,
              payload: null,
              errors: [notFound ? 'Item not found' : 'Failed to fetch item data'],
            };
          }

          const itemEnResponse = responses.item_en || { status: 0, data: null };
          if (itemEnResponse.status === 200 && itemEnResponse.data) {
            try {
              const parsed = JSON.parse(itemEnResponse.data);
              if (parsed && typeof parsed === 'object' && parsed.name) {
                item.name_en = parsed.name;
              } else {
                item.name_en = null;
              }
            } catch (error) {
              item.name_en = null;
              if (logger && typeof logger.warn === 'function') {
                logger.warn(`[legacy] invalid item_en JSON for ${itemId}: ${error.message}`);
              }
            }
          } else {
            item.name_en = null;
          }
          guard();

          const hasIcon = item.icon != null && item.icon !== '';
          item.icon = hasIcon ? item.icon : null;
          item.iconFallback = !hasIcon;
          item.iconPlaceholder = item.iconFallback ? ITEM_ICON_PLACEHOLDER : null;

          let recipe = null;
          const recipeSearchResponse = responses.recipe_search || { status: 0, data: null };
          if (recipeSearchResponse.status === 200 && recipeSearchResponse.data) {
            try {
              const ids = JSON.parse(recipeSearchResponse.data);
              if (Array.isArray(ids) && ids.length > 0) {
                const recipeId = ids[0];
                const recipeResult = await fetchJsonResource(
                  fetchImpl,
                  `${config.recipesEndpoint}/${recipeId}?lang=${lang}`,
                  config.fetchTimeoutMs,
                );
                if (recipeResult.status === 200 && recipeResult.data) {
                  recipe = recipeMinFromData(recipeResult.data);
                }
              }
            } catch (error) {
              if (logger && typeof logger.warn === 'function') {
                logger.warn(`[legacy] invalid recipe search JSON for ${itemId}: ${error.message}`);
              }
            }
          }
          guard();

          let market = {};
          const marketResponse = responses.market || { status: 0, data: null };
          if (marketResponse.status === 200 && marketResponse.data) {
            market = parseMarketCsv(marketResponse.data);
          }
          guard();

          let nested = null;
          if (!flags.usePrecomputed) {
            const nestedResult = await fetchJsonResource(
              fetchImpl,
              `${config.recipeTreeEndpoint}/${itemId}`,
              config.fetchTimeoutMs,
            );
            if (nestedResult.status === 200) {
              nested = nestedResult.data;
            }
          }

          return {
            status: 200,
            payload: {
              item,
              recipe,
              market,
              nested_recipe: nested,
            },
            errors: [],
          };
        },
        config.maxAggregationMs,
      );

      if (aggregation.stale) {
        deps.fail(res, 200, 'aggregation_timeout', 'Aggregation timeout exceeded', {
          lang,
          source: 'fallback',
          stale: true,
        });
        return;
      }

      const result = aggregation.data || {};
      const status = result.status == null ? 200 : result.status;
      const payload = result.payload ?? null;
      const errors = Array.isArray(result.errors) ? result.errors : [];

      if (status !== 200) {
        const primaryError = errors.length > 0 ? errors[0] : 'Unexpected error';
        deps.fail(res, status, 'aggregation_failed', primaryError, {
          lang,
          source: 'fallback',
          stale: status >= 500,
        }, errors);
        return;
      }

      deps.ok(
        res,
        payload,
        {
          lang,
          source,
          stale: false,
        },
        {
          errors,
          headers: {
            'Cache-Control': `public, max-age=${config.cacheTtlFast}, stale-while-revalidate=${config.cacheTtlFast}`,
          },
        },
      );
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[legacy] unexpected item details error for ${itemId}: ${error.message}`);
      }
      deps.fail(
        res,
        500,
        'item_details_unexpected',
        'Unexpected item details error',
        {
          lang,
          source,
          stale: true,
        },
        { code: 'exception', msg: error && error.message ? error.message : 'Unexpected error' },
      );
    }
  }

  async function handleDataBundle(_req, res, context = {}) {
    const url = context.url instanceof URL ? context.url : new URL(context.url || '/', 'http://localhost');
    const lang = context.lang ? normalizeLang(context.lang) : normalizeLang(url.searchParams.get('lang'));
    const ids = parseNumericParamList(url.searchParams, 'ids');

    if (ids.length === 0) {
      deps.fail(res, 400, 'ids_required', 'ids required', {
        lang,
        source: 'local',
        stale: false,
      });
      return;
    }

    if (invalidateCache) {
      const invalidateIds = parseNumericParamList(url.searchParams, 'invalidate');
      if (invalidateIds.length > 0) {
        const instructions = buildBundleInvalidationInstructions(invalidateIds);
        try {
          invalidateCache(instructions);
        } catch (error) {
          if (logger && typeof logger.warn === 'function') {
            logger.warn(`[legacy] failed to invalidate bundle caches: ${error.message}`);
          }
        }
      }
    }

    let source = 'local';
    try {
      const flags = resolveFeatureFlags(url.searchParams, config.featureFlags);
      source = flags.forceLocalOnly ? 'local' : 'fallback';
      if (flags.usePrecomputed) {
        source = 'fallback';
      }

      const aggregation = await withTimeout(
        async (guard) => {
          guard();
          const idStr = ids.join(',');
          const requests = {
            items: {
              url: `${config.itemsEndpoint}?ids=${idStr}&lang=${lang}`,
            },
            items_en: {
              url: `${config.itemsEndpoint}?ids=${idStr}&lang=en`,
            },
            market: {
              url: `${config.marketCsvUrl}?fields=id,buy_price,sell_price&ids=${idStr}`,
            },
          };

          ids.forEach((id) => {
            requests[`recipe_search_${id}`] = {
              url: `${config.recipesSearchEndpoint}?output=${id}`,
            };
          });

          const responses = await multiFetch(requests, fetchImpl, config.fetchTimeoutMs);
          guard();

          let items = [];
          const itemsResponse = responses.items || { status: 0, data: null };
          if (itemsResponse.status === 200 && itemsResponse.data) {
            try {
              const parsed = JSON.parse(itemsResponse.data);
              if (Array.isArray(parsed)) {
                items = parsed;
              }
            } catch (error) {
              if (logger && typeof logger.warn === 'function') {
                logger.warn(`[legacy] invalid items bundle JSON: ${error.message}`);
              }
            }
          }

          if (!Array.isArray(items)) {
            return {
              status: 502,
              payload: null,
              errors: ['Failed to fetch item data'],
            };
          }

          const itemEnMap = new Map();
          const itemsEnResponse = responses.items_en || { status: 0, data: null };
          if (itemsEnResponse.status === 200 && itemsEnResponse.data) {
            try {
              const parsed = JSON.parse(itemsEnResponse.data);
              if (Array.isArray(parsed)) {
                parsed.forEach((entry) => {
                  if (entry && typeof entry === 'object' && entry.id != null) {
                    itemEnMap.set(entry.id, entry);
                  }
                });
              }
            } catch (error) {
              if (logger && typeof logger.warn === 'function') {
                logger.warn(`[legacy] invalid items_en bundle JSON: ${error.message}`);
              }
            }
          }
          guard();

          const itemMap = new Map();
          items.forEach((item) => {
            if (!item || typeof item !== 'object' || item.id == null) {
              return;
            }
            const id = item.id;
            const hasIcon = item.icon != null && item.icon !== '';
            const iconValue = hasIcon ? item.icon : null;
            const iconFallback = !hasIcon;
            itemMap.set(id, {
              id,
              name: item.name ?? null,
              name_en: itemEnMap.get(id)?.name ?? null,
              icon: iconValue,
              iconFallback,
              iconPlaceholder: iconFallback ? ITEM_ICON_PLACEHOLDER : null,
              rarity: item.rarity ?? null,
            });
          });
          guard();

          let marketMap = {};
          const marketResponse = responses.market || { status: 0, data: null };
          if (marketResponse.status === 200 && marketResponse.data) {
            marketMap = parseMarketBundleCsv(marketResponse.data);
          }
          guard();

          const recipeIds = new Map();
          ids.forEach((id) => {
            const key = `recipe_search_${id}`;
            const response = responses[key];
            if (response && response.status === 200 && response.data) {
              try {
                const parsed = JSON.parse(response.data);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  recipeIds.set(id, parsed[0]);
                }
              } catch (error) {
                if (logger && typeof logger.warn === 'function') {
                  logger.warn(`[legacy] invalid recipe search JSON for ${id}: ${error.message}`);
                }
              }
            }
          });
          guard();

          const recipeRequests = {};
          for (const [itemId, recipeId] of recipeIds.entries()) {
            recipeRequests[itemId] = {
              url: `${config.recipesEndpoint}/${recipeId}?lang=${lang}`,
            };
          }

          const recipeResponses = await multiFetch(recipeRequests, fetchImpl, config.fetchTimeoutMs);
          guard();

          const recipeMap = new Map();
          for (const [itemId, response] of Object.entries(recipeResponses)) {
            if (response && response.status === 200 && response.data) {
              try {
                const parsed = JSON.parse(response.data);
                recipeMap.set(Number(itemId), recipeMinFromData(parsed));
              } catch (error) {
                if (logger && typeof logger.warn === 'function') {
                  logger.warn(`[legacy] invalid recipe JSON for ${itemId}: ${error.message}`);
                }
              }
            }
          }

          const result = [];
          const now = Math.floor(Date.now() / 1000);
          ids.forEach((id) => {
            const item = itemMap.get(id);
            if (!item) {
              return;
            }
            result.push({
              id,
              item,
              recipe: recipeMap.get(id) ?? null,
              market: marketMap[id] ?? {},
              extra: {
                last_updated: now,
              },
            });
          });

          return {
            status: 200,
            payload: result,
            errors: [],
          };
        },
        config.maxAggregationMs,
      );

      if (aggregation.stale) {
        deps.fail(res, 200, 'aggregation_timeout', 'Aggregation timeout exceeded', {
          lang,
          source: 'fallback',
          stale: true,
        });
        return;
      }

      const result = aggregation.data || {};
      const status = result.status == null ? 200 : result.status;
      const payload = result.payload ?? null;
      const errors = Array.isArray(result.errors) ? result.errors : [];

      if (status !== 200) {
        const primaryError = errors.length > 0 ? errors[0] : 'Unexpected error';
        deps.fail(res, status, 'aggregation_failed', primaryError, {
          lang,
          source: 'fallback',
          stale: status >= 500,
        }, errors);
        return;
      }

      deps.ok(
        res,
        payload,
        {
          lang,
          source,
          stale: false,
        },
        {
          errors,
          headers: {
            'Cache-Control': `public, max-age=${config.cacheTtlFast}, stale-while-revalidate=${config.cacheTtlFast}`,
          },
        },
      );
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[legacy] unexpected data bundle error: ${error.message}`);
      }
      deps.fail(
        res,
        500,
        'data_bundle_unexpected',
        'Unexpected data bundle error',
        {
          lang,
          source,
          stale: true,
        },
        { code: 'exception', msg: error && error.message ? error.message : 'Unexpected error' },
      );
    }
  }

  return {
    handleItemDetails,
    handleDataBundle,
  };
}

module.exports = {
  createLegacyHandlers,
  __private: {
    createConfig,
    defaultNormalizeLang,
    normalizeIds,
    parseMarketCsv,
    parseMarketBundleCsv,
    recipeMinFromData,
    resolveFeatureFlags,
    parseNumericParamList,
    buildItemInvalidationInstructions,
    buildBundleInvalidationInstructions,
    withTimeout,
  },
};
