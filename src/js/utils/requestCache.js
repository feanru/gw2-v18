import { getCached } from './cache.js';
import fetchWithRetry from './fetchWithRetry.js';

const activeRequests = new Map();

export function getRequest(url) {
  return activeRequests.get(url)?.promise;
}

function setRequest(url, promise, controller) {
  activeRequests.set(url, { promise, controller });
  promise.finally(() => activeRequests.delete(url));
  return promise;
}

export function abortRequest(url) {
  const entry = activeRequests.get(url);
  if (entry?.controller) entry.controller.abort();
}

export function fetchWithCache(url, options = {}, cacheKey = null, cached = null, signal) {
  const existing = activeRequests.get(url);
  if (existing) existing.controller?.abort();

  if (cacheKey && !cached) {
    cached = getCached(cacheKey, true);
  }

  const headers = { ...(options.headers || {}) };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

  const controller = signal ? null : new AbortController();
  const fetchSignal = signal ?? options.signal ?? controller?.signal;

  const promise = fetchWithRetry(url, { ...options, headers, signal: fetchSignal }).then(async (response) => {
    if (response.status === 304 && cached) {
      return new Response(JSON.stringify(cached.value), {
        status: 200,
        headers: {
          'X-Cache': 'HIT',
          'ETag': cached.etag || '',
          'Last-Modified': cached.lastModified || ''
        }
      });
    }
    return response;
  }).catch(err => {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw err;
  });

  return setRequest(url, promise, controller).then(r => r.clone());
}

export default {
  fetchWithCache,
  getRequest,
  setRequest: (url, promise) => setRequest(url, promise, null),
  abortRequest
};
