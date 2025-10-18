const STORAGE_KEY = 'gw2.precomputed.bucket';
const MAX_BUCKET = 100;

function readStorage(storage) {
  if (!storage) return null;
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(storage, value) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore storage errors (quota, disabled, etc.)
  }
}

function parseBucket(value) {
  if (value == null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed >= MAX_BUCKET) {
    return null;
  }
  return parsed;
}

function resolveStorage() {
  if (typeof window !== 'undefined' && window && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

export function getBucket() {
  const storage = resolveStorage();
  const storedValue = parseBucket(readStorage(storage));
  if (storedValue !== null) {
    return storedValue;
  }

  const random = Math.floor(Math.random() * MAX_BUCKET);
  writeStorage(storage, random);
  return random;
}

export { STORAGE_KEY };
