import fetchWithRetry from '../utils/fetchWithRetry.js';
import { normalizeApiResponse } from '../utils/apiResponse.js';
import { toUiModel as toAggregateUiModel } from '../adapters/aggregateAdapter.js';
import { prepareLangRequest, getActiveLanguage } from './langContext.js';

const STORAGE_PREFIX = 'aggregate:item';
const memorySession = new Map();

function getSessionStorageSafe() {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage;
    }
  } catch (err) {
    console.warn('Sesión de almacenamiento no disponible', err);
  }
  return null;
}

function readStore(key) {
  const storage = getSessionStorageSafe();
  if (storage) {
    try {
      return storage.getItem(key);
    } catch (err) {
      console.warn('No se pudo leer sessionStorage', err);
    }
  }
  return memorySession.get(key) ?? null;
}

function writeStore(key, value) {
  const storage = getSessionStorageSafe();
  if (storage) {
    try {
      if (value === null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, value);
      }
    } catch (err) {
      console.warn('No se pudo escribir en sessionStorage', err);
    }
  }
  if (value === null) {
    memorySession.delete(key);
  } else {
    memorySession.set(key, value);
  }
}

function buildCacheKey(itemId, lang) {
  const normalizedLang = typeof lang === 'string' && lang ? lang : getActiveLanguage();
  return `${STORAGE_PREFIX}:${normalizedLang}:${itemId}`;
}

function readCache(itemId, lang) {
  const raw = readStore(buildCacheKey(itemId, lang));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      etag: typeof parsed.etag === 'string' && parsed.etag ? parsed.etag : null,
      lastModified: typeof parsed.lastModified === 'string' && parsed.lastModified ? parsed.lastModified : null,
      data: parsed.data ?? null,
      meta: parsed.meta ?? null,
    };
  } catch (err) {
    console.warn('No se pudo parsear el cache del agregado', err);
    return null;
  }
}

function writeCache(itemId, lang, { etag = null, lastModified = null, data = null, meta = null } = {}) {
  const record = {
    etag: etag || null,
    lastModified: lastModified || null,
    data: data ?? null,
    meta: meta ?? null,
  };
  writeStore(buildCacheKey(itemId, lang), JSON.stringify(record));
}

function getHeader(response, name) {
  const target = String(name || '').toLowerCase();
  if (!response || !response.headers) return null;
  if (typeof response.headers.get === 'function') {
    const direct = response.headers.get(name);
    if (direct) return direct;
    return response.headers.get(target);
  }
  const headerEntries =
    typeof response.headers.entries === 'function'
      ? Array.from(response.headers.entries())
      : Object.entries(response.headers);
  for (const [key, value] of headerEntries) {
    if (String(key).toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return null;
}

export async function fetchItemAggregate(itemId, { signal } = {}) {
  if (!Number.isFinite(Number(itemId)) || Number(itemId) <= 0) {
    throw new Error('ID de ítem inválido');
  }
  const id = Number(itemId);
  const lang = getActiveLanguage();
  const cached = readCache(id, lang);
  const headers = {};
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }
  if (cached?.lastModified) {
    headers['If-Modified-Since'] = cached.lastModified;
  }

  const { url: requestUrl, options: requestOptions, lang: requestLang } = prepareLangRequest(
    `/api/items/${id}/aggregate`,
    {
      signal,
      headers,
    },
  );

  const response = await fetchWithRetry(requestUrl, requestOptions);
  const etag = getHeader(response, 'ETag');
  const lastModified = getHeader(response, 'Last-Modified');

  if (response.status === 304) {
    if (cached?.data) {
      writeCache(id, requestLang, {
        etag: etag || cached.etag || null,
        lastModified: lastModified || cached.lastModified || null,
        data: cached.data,
        meta: cached.meta,
      });
      const model = toAggregateUiModel({ data: cached.data, meta: cached.meta });
      return {
        data: cached.data,
        meta: cached.meta,
        model,
        status: 304,
        fromCache: true,
      };
    }
    throw new Error('Respuesta 304 sin datos en cache');
  }

  const contentType = getHeader(response, 'content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Respuesta no válida del agregado');
  }
  const raw = await response.json().catch(() => null);
  const { data, meta } = normalizeApiResponse(raw);
  const model = toAggregateUiModel({ data, meta });
  writeCache(id, requestLang, { etag, lastModified, data, meta });
  return { data, meta, model, status: response.status, fromCache: false };
}

export function __clearAggregateItemCacheForTests() {
  memorySession.clear();
  const storage = getSessionStorageSafe();
  if (storage && typeof storage.length === 'number') {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && key.startsWith(`${STORAGE_PREFIX}:`)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => {
      try {
        storage.removeItem(key);
      } catch (err) {
        console.warn('No se pudo limpiar sessionStorage', err);
      }
    });
  }
}
