import assert from 'node:assert/strict';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

async function importFresh(specifier, tag) {
  return import(`${specifier}?bucketTest=${tag}&ts=${Date.now()}`);
}

async function run() {
  const storage = createMemoryStorage();
  const originalRandom = Math.random;
  const previousWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
    ? globalThis.window
    : undefined;
  const previousLocalStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage')
    ? globalThis.localStorage
    : undefined;

  try {
    globalThis.window = {
      localStorage: storage
    };
    globalThis.localStorage = storage;

    const bucketModule = await importFresh('../src/js/utils/canaryBucket.js', 'first-load');
    const { getBucket, STORAGE_KEY } = bucketModule;

    let randomCalls = 0;
    Math.random = () => {
      randomCalls += 1;
      return 0.73;
    };

    const firstBucket = getBucket();
    assert.equal(firstBucket, 73);
    assert.equal(storage.getItem(STORAGE_KEY), '73');
    assert.equal(randomCalls, 1);

    Math.random = () => {
      throw new Error('random should not be called when bucket is cached');
    };
    const secondBucket = getBucket();
    assert.equal(secondBucket, 73);

    const reloadedModule = await importFresh('../src/js/utils/canaryBucket.js', 'second-load');
    Math.random = () => {
      throw new Error('random should not be called after module reload with persisted bucket');
    };
    const thirdBucket = reloadedModule.getBucket();
    assert.equal(thirdBucket, 73);

    console.log('canary bucket tests passed');
  } finally {
    Math.random = originalRandom;
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
