import CACHE_TTLS from './cachePolicies.js';
import { setupCacheSync, notifySet, notifyDelete, requestBundleSync } from './cacheSync.js';
import fetchWithRetry from './fetchWithRetry.js';

const cacheStore = new Map();
setupCacheSync(cacheStore);
requestBundleSync();
const STORAGE_AVAILABLE = typeof localStorage !== 'undefined';
const inFlight = new Map();

function requestKey(url, { method = 'GET', headers = {} } = {}) {
  return `${url}|${method.toUpperCase()}|${JSON.stringify(headers)}`;
}

function serializeEntry({ value, expiresAt, etag, lastModified, lang, source, fallback }) {
  return JSON.stringify({ value, expiresAt, etag, lastModified, lang, source, fallback });
}

function deserializeEntry(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStorage(key, entry) {
  if (!STORAGE_AVAILABLE) return;
  try {
    localStorage.setItem(key, serializeEntry(entry));
  } catch {
    // ignore storage errors (quota, etc.)
  }
}

function readStorage(key) {
  if (!STORAGE_AVAILABLE) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const data = deserializeEntry(raw);
  if (!data) {
    localStorage.removeItem(key);
    return null;
  }
  return data;
}

function cleanExpired() {
  if (!STORAGE_AVAILABLE) return;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const data = deserializeEntry(localStorage.getItem(key));
    if (!data) continue;
    const { expiresAt } = data;
    if (expiresAt && Date.now() > expiresAt) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => {
    localStorage.removeItem(k);
    notifyDelete(k);
  });
}

cleanExpired();

export function setCached(key, value, ttlMs = undefined, meta = {}) {
  if (ttlMs === undefined) {
    const prefix = key.split('_')[0];
    ttlMs = CACHE_TTLS[prefix];
  }
  const expiresAt = ttlMs == null ? null : Date.now() + ttlMs;
  const { etag = null, lastModified = null, lang = null, source = null, fallback = null } = meta;
  const entry = {
    value,
    expiresAt,
    updatedAt: new Date().toISOString(),
    etag,
    lastModified,
    lang,
    source,
    fallback,
  };
  cacheStore.set(key, entry);
  writeStorage(key, { value, expiresAt, etag, lastModified, lang, source, fallback });
  notifySet(key, entry);
}

export function getCached(key, withMeta = false) {
  let entry = cacheStore.get(key);
  if (!entry) {
    const data = readStorage(key);
    if (data) {
      const {
        value,
        expiresAt = null,
        etag = null,
        lastModified = null,
        lang = null,
        source = null,
        fallback = null,
      } = data;
      entry = {
        value,
        expiresAt,
        updatedAt: new Date().toISOString(),
        etag,
        lastModified,
        lang,
        source,
        fallback,
      };
      cacheStore.set(key, entry);
    }
  }
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    if (STORAGE_AVAILABLE) localStorage.removeItem(key);
    notifyDelete(key);
    return null;
  }
  return withMeta ? entry : entry.value;
}

export function clearCachedPrefix(prefix) {
  if (!prefix) {
    return 0;
  }
  const normalized = String(prefix);
  const clearedKeys = new Set();

  cacheStore.forEach((value, key) => {
    if (key.startsWith(normalized)) {
      cacheStore.delete(key);
      clearedKeys.add(key);
    }
  });

  if (STORAGE_AVAILABLE) {
    const toRemove = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(normalized)) {
        toRemove.push(key);
        clearedKeys.add(key);
      }
    }
    toRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore storage errors
      }
    });
  }

  clearedKeys.forEach((key) => notifyDelete(key));

  return clearedKeys.size;
}

export function fetchDedup(url, options = {}) {
  const key = requestKey(url, options);
  const base =
    inFlight.get(key) ||
    fetchWithRetry(url, options).finally(() => inFlight.delete(key));
  inFlight.set(key, base);
  return base.then((res) => res.clone());
}

export default {
  getCached,
  setCached,
  fetchDedup,
  clearCachedPrefix,
};

