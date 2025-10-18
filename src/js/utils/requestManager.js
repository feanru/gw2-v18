import { getCached, setCached } from './cache.js';
import fetchWithRetry from './fetchWithRetry.js';
import apiHealth from './apiHealth.js';
import { getConfig } from '../config.js';
const MAX_BATCH = 200;
const FLUSH_MS = 50;

const queue = new Set();
const pending = new Map();
let timer = null;
let controller = null;

function normalizeId(value) {
  const numericId = Number(value);
  return Number.isNaN(numericId) ? value : numericId;
}

function extractItemPayload(payload) {
  if (!payload) {
    return { item: payload, meta: null };
  }

  if (payload.data && payload.data.item) {
    const normalizedItem = { ...payload.data.item };
    const meta = payload.meta || {};
    ['lang', 'source', 'fallback'].forEach((key) => {
      if (typeof meta[key] !== 'undefined' && typeof normalizedItem[key] === 'undefined') {
        normalizedItem[key] = meta[key];
      }
    });
    const normalizedMeta = {};
    if (typeof meta.lang !== 'undefined') normalizedMeta.lang = meta.lang;
    if (typeof meta.source !== 'undefined') normalizedMeta.source = meta.source;
    if (typeof meta.fallback !== 'undefined') normalizedMeta.fallback = meta.fallback;
    return {
      item: normalizedItem,
      meta: Object.keys(normalizedMeta).length ? normalizedMeta : null,
    };
  }

  if (payload.meta && (typeof payload.meta === 'object')) {
    const normalizedMeta = {};
    if (typeof payload.meta.lang !== 'undefined') normalizedMeta.lang = payload.meta.lang;
    if (typeof payload.meta.source !== 'undefined') normalizedMeta.source = payload.meta.source;
    if (typeof payload.meta.fallback !== 'undefined') normalizedMeta.fallback = payload.meta.fallback;
    return {
      item: payload,
      meta: Object.keys(normalizedMeta).length ? normalizedMeta : null,
    };
  }

  return { item: payload, meta: null };
}

function buildHeaders(ids, lang) {
  if (ids.length !== 1) return {};
  const cached = getCached(`item_${ids[0]}`, true);
  if (!cached) return {};
  if (cached.lang && lang && cached.lang !== lang) return {};
  const headers = {};
  if (cached.etag) headers['If-None-Match'] = cached.etag;
  if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
  return headers;
}

// Precarga en memoria los items cacheados recientemente
function preloadCache() {
  if (typeof localStorage === 'undefined') return;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('item_')) getCached(key);
  }
}
preloadCache();

function scheduleFlush() {
  if (!timer) {
    timer = setTimeout(flush, FLUSH_MS);
  }
  if (queue.size >= MAX_BATCH) {
    clearTimeout(timer);
    flush();
  }
}

async function fetchBatch(ids, lang, { baseUrl, signal, backoff, allowConditional }) {
  if (!ids.length) {
    return {
      status: 200,
      items: new Map(),
      missing: [],
      metaById: new Map(),
    };
  }
  const langParam = lang ? `&lang=${lang}` : '';
  const headers = allowConditional ? buildHeaders(ids, lang) : {};
  const res = await fetchWithRetry(`${baseUrl}${ids.join(',')}${langParam}`, {
    headers,
    signal,
    backoff,
  });
  if (res.status === 304) {
    return { status: 304 };
  }
  if (!res.ok) {
    throw new Error(`Unexpected response status: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response format');
  }
  const etag = res.headers.get('ETag');
  const lastModified = res.headers.get('Last-Modified');
  const items = new Map();
  const metaById = new Map();
  data.forEach((entry) => {
    const { item, meta } = extractItemPayload(entry);
    if (!item || typeof item.id === 'undefined') return;
    const normalizedId = normalizeId(item.id);
    items.set(normalizedId, item);
    const normalizedMeta = { etag, lastModified, lang };
    if (meta) {
      if (typeof meta.lang !== 'undefined') normalizedMeta.lang = meta.lang;
      if (typeof meta.source !== 'undefined') normalizedMeta.source = meta.source;
      if (typeof meta.fallback !== 'undefined') normalizedMeta.fallback = meta.fallback;
    }
    metaById.set(normalizedId, normalizedMeta);
  });
  const missing = ids.filter((id) => !items.has(id));
  return { status: res.status, items, missing, metaById };
}

async function flush() {
  if (queue.size === 0) {
    timer = null;
    return;
  }
  timer = null;
  const ids = Array.from(queue).slice(0, MAX_BATCH);
  ids.forEach((id) => queue.delete(id));
  try {
    const extraDelay = apiHealth.getBackoff();
    if (extraDelay) await new Promise((res) => setTimeout(res, extraDelay));
    controller = new AbortController();
    const { API_BASE_URL, LANG, DEFAULT_LANG, FALLBACK_LANGS = [] } = getConfig();
    const normalizedLang = (LANG || DEFAULT_LANG || '').trim() || 'es';
    const fallbackLangs = Array.isArray(FALLBACK_LANGS)
      ? [...new Set(FALLBACK_LANGS.filter((l) => l && l !== normalizedLang))]
      : [];
    const baseUrl = `${API_BASE_URL}/items?ids=`;
    const backoff = 300 + extraDelay;

    let batchResult = null;
    try {
      batchResult = await fetchBatch(ids, normalizedLang, {
        baseUrl,
        signal: controller.signal,
        backoff,
        allowConditional: true,
      });
      if (batchResult.status === 304) {
        ids.forEach((id) => {
          const entry = pending.get(id);
          const cached = getCached(`item_${id}`);
          if (entry) entry.resolve(cached);
          pending.delete(id);
        });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      batchResult = null;
    }

    const resolvedItems = new Map();
    const metaById = new Map();
    let missing = [...ids];
    if (batchResult && batchResult.items) {
      batchResult.items.forEach((item, id) => {
        const normalizedId = normalizeId(id);
        resolvedItems.set(normalizedId, item);
        const meta = batchResult.metaById?.get(id);
        if (meta) metaById.set(normalizedId, meta);
      });
      missing = batchResult.missing;
    }

    for (const fallbackLang of fallbackLangs) {
      if (!missing.length) break;
      let fallbackResult = null;
      try {
        fallbackResult = await fetchBatch(missing, fallbackLang, {
          baseUrl,
          signal: controller.signal,
          backoff,
          allowConditional: false,
        });
        if (fallbackResult.status === 304) {
          const stillMissing = [];
          missing.forEach((id) => {
            const cachedEntry = getCached(`item_${id}`, true);
            if (cachedEntry && cachedEntry.value) {
              resolvedItems.set(id, cachedEntry.value);
              metaById.set(id, {
                etag: cachedEntry.etag ?? null,
                lastModified: cachedEntry.lastModified ?? null,
                lang: cachedEntry.lang ?? fallbackLang,
              });
            } else {
              stillMissing.push(id);
            }
          });
          missing = stillMissing;
          continue;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        continue;
      }
      if (fallbackResult && fallbackResult.items) {
        fallbackResult.items.forEach((item, id) => {
          const normalizedId = normalizeId(id);
          resolvedItems.set(normalizedId, item);
          const meta = fallbackResult.metaById?.get(id);
          if (meta) {
            metaById.set(normalizedId, meta);
          } else {
            metaById.set(normalizedId, { lang: fallbackLang });
          }
        });
        missing = fallbackResult.missing;
      }
    }

    if (missing.length) {
      const stillMissing = [];
      await Promise.all(missing.map(async (id) => {
        const normalizedId = normalizeId(id);
        try {
          const itemUrl = `${API_BASE_URL}/items/${id}?lang=${normalizedLang}`;
          const res = await fetchWithRetry(itemUrl, {
            signal: controller.signal,
            backoff,
          });

          if (res.status === 304) {
            const cachedEntry = getCached(`item_${normalizedId}`, true);
            if (cachedEntry && cachedEntry.value) {
              resolvedItems.set(normalizedId, cachedEntry.value);
              metaById.set(normalizedId, {
                etag: cachedEntry.etag ?? null,
                lastModified: cachedEntry.lastModified ?? null,
                lang: cachedEntry.lang ?? normalizedLang,
                source: cachedEntry.source ?? null,
                fallback: cachedEntry.fallback ?? null,
              });
              return;
            }
            stillMissing.push(normalizedId);
            return;
          }

          if (res.status === 404) {
            stillMissing.push(normalizedId);
            return;
          }

          if (!res.ok) {
            console.warn(`[requestManager] failed to fetch item ${id}: unexpected status ${res.status}`);
            stillMissing.push(normalizedId);
            return;
          }

          const attemptOfficialFallback = async (reason) => {
            console.warn(`[requestManager] official API fallback for item ${id}: ${reason}`);
            try {
              const officialUrl = `https://api.guildwars2.com/v2/items/${id}?lang=${normalizedLang}`;
              const officialRes = await fetchWithRetry(officialUrl, {
                signal: controller.signal,
                backoff,
              });

              if (!officialRes.ok) {
                console.warn(`[requestManager] official API fallback failed for item ${id}: unexpected status ${officialRes.status}`);
                return false;
              }

              const officialContentType = officialRes.headers.get('content-type');
              if (!officialContentType || !String(officialContentType).toLowerCase().includes('application/json')) {
                console.warn(`[requestManager] official API fallback failed for item ${id}: unexpected content-type ${officialContentType || 'unknown'}`);
                return false;
              }

              let officialPayload;
              try {
                officialPayload = await officialRes.json();
              } catch (fallbackErr) {
                if (fallbackErr instanceof SyntaxError) {
                  console.warn(`[requestManager] official API fallback failed for item ${id}: invalid JSON response`, fallbackErr);
                  return false;
                }
                throw fallbackErr;
              }

              const { item: officialItem, meta: officialMeta } = extractItemPayload(officialPayload);
              if (!officialItem || typeof officialItem.id === 'undefined') {
                console.warn(`[requestManager] official API fallback failed for item ${id}: missing item id`);
                return false;
              }

              const officialResolvedId = normalizeId(officialItem.id);
              const fallbackMeta = {
                etag: officialRes.headers.get('ETag'),
                lastModified: officialRes.headers.get('Last-Modified'),
                lang: officialItem.lang || officialMeta?.lang || normalizedLang,
                source: officialMeta?.source || 'official-api',
                fallback: officialMeta?.fallback || 'official-api',
              };
              if (officialItem.source) fallbackMeta.source = officialItem.source;
              if (officialItem.fallback) fallbackMeta.fallback = officialItem.fallback;
              resolvedItems.set(officialResolvedId, officialItem);
              metaById.set(officialResolvedId, fallbackMeta);
              setCached(`item_${officialResolvedId}`, officialItem, undefined, fallbackMeta);
              return true;
            } catch (fallbackErr) {
              if (fallbackErr instanceof DOMException && fallbackErr.name === 'AbortError') {
                throw fallbackErr;
              }
              console.warn(`[requestManager] official API fallback failed for item ${id}: ${fallbackErr && fallbackErr.message ? fallbackErr.message : fallbackErr}`);
              return false;
            }
          };

          const contentType = res.headers.get('content-type');
          if (!contentType || !String(contentType).toLowerCase().includes('application/json')) {
            const fallbackSuccess = await attemptOfficialFallback(`unexpected content-type ${contentType || 'unknown'}`);
            if (!fallbackSuccess) stillMissing.push(normalizedId);
            return;
          }

          let payload;
          try {
            payload = await res.json();
          } catch (err) {
            if (err instanceof SyntaxError) {
              const fallbackSuccess = await attemptOfficialFallback('invalid JSON response');
              if (!fallbackSuccess) stillMissing.push(normalizedId);
              return;
            }
            throw err;
          }
          const { item, meta: responseMeta } = extractItemPayload(payload);
          if (!item || typeof item.id === 'undefined') {
            stillMissing.push(normalizedId);
            return;
          }

          const resolvedId = normalizeId(item.id);
          const meta = {
            etag: res.headers.get('ETag'),
            lastModified: res.headers.get('Last-Modified'),
            lang: item.lang || normalizedLang,
          };
          if (responseMeta) {
            if (typeof responseMeta.lang !== 'undefined') meta.lang = responseMeta.lang;
            if (typeof responseMeta.source !== 'undefined') meta.source = responseMeta.source;
            if (typeof responseMeta.fallback !== 'undefined') meta.fallback = responseMeta.fallback;
          }
          if (item.source) meta.source = item.source;
          if (item.fallback) meta.fallback = item.fallback;
          resolvedItems.set(resolvedId, item);
          metaById.set(resolvedId, meta);
          setCached(`item_${resolvedId}`, item, undefined, meta);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          console.warn(`[requestManager] failed to fetch item ${id}: ${err && err.message ? err.message : err}`);
          stillMissing.push(normalizedId);
        }
      }));
      missing = stillMissing;
    }

    ids.forEach((id) => {
      const normalizedId = normalizeId(id);
      const entry = pending.get(normalizedId) || pending.get(id);
      if (!entry) return;
      const item = resolvedItems.get(normalizedId);
      if (item) {
        const baseMeta = metaById.get(normalizedId) || { lang: normalizedLang };
        const finalMeta = { ...baseMeta };
        if (item && item.lang) {
          finalMeta.lang = item.lang;
        }
        if (item && item.source) {
          finalMeta.source = item.source;
        }
        if (item && item.fallback) {
          finalMeta.fallback = item.fallback;
        }
        metaById.set(normalizedId, finalMeta);
        setCached(`item_${normalizedId}`, item, undefined, finalMeta);
        entry.resolve(item);
      } else {
        entry.resolve(null);
      }
      pending.delete(normalizedId);
      if (normalizedId !== id) pending.delete(id);
    });
  } catch (err) {
    ids.forEach((id) => {
      const entry = pending.get(id);
      if (!entry) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        entry.reject(err);
      } else {
        entry.reject(err);
      }
      pending.delete(id);
    });
  }
  if (queue.size > 0) {
    scheduleFlush();
  }
}

export function requestItems(ids = [], signal) {
  if (controller) {
    controller.abort();
    controller = null;
  }
  if (signal) {
    signal.addEventListener('abort', () => controller && controller.abort(), { once: true });
  }
  const promises = ids.map(rawId => {
    const id = normalizeId(rawId);
    const cacheKey = `item_${id}`;
    const cached = getCached(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (pending.has(id)) return pending.get(id).promise;
    const entry = {};
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    pending.set(id, entry);
    queue.add(id);
    scheduleFlush();
    return entry.promise;
  });
  return Promise.all(promises);
}

export function abortRequests() {
  if (controller) {
    controller.abort();
    controller = null;
  }
  queue.clear();
  pending.forEach(entry => entry.reject(new DOMException('Aborted', 'AbortError')));
  pending.clear();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
