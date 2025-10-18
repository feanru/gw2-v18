const channel = (typeof window !== 'undefined' && 'BroadcastChannel' in window)
  ? new BroadcastChannel('cache-sync')
  : null;

let store = null;

export function setupCacheSync(cacheStore) {
  store = cacheStore;
  if (!channel) return;
  channel.addEventListener('message', ({ data }) => {
    const { type, key, entry } = data || {};

    if (type === 'request-bundles') {
      // Send all cached bundle entries to the requester
      if (!store) return;
      store.forEach((e, k) => {
        if (k.startsWith('bundle_')) {
          channel.postMessage({ type: 'set', key: k, entry: e });
        }
      });
      return;
    }

    if (!type || !key) return;
    if (type === 'set' && entry) {
      store.set(key, entry);
    } else if (type === 'delete') {
      store.delete(key);
    }
  });
}

export function notifySet(key, entry) {
  if (!channel) return;
  channel.postMessage({ type: 'set', key, entry });
}

export function notifyDelete(key) {
  if (!channel) return;
  channel.postMessage({ type: 'delete', key });
}

export function requestBundleSync() {
  if (!channel) return;
  channel.postMessage({ type: 'request-bundles' });
}
