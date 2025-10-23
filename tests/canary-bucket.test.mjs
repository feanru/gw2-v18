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
    const {
      getBucket,
      getAssignments,
      syncAssignments,
      STORAGE_KEY,
      ASSIGNMENTS_STORAGE_KEY,
    } = bucketModule;

    let randomCalls = 0;
    Math.random = () => {
      randomCalls += 1;
      return 0.73;
    };

    const firstBucket = getBucket();
    assert.equal(firstBucket, 73);
    assert.equal(storage.getItem(STORAGE_KEY), '73');
    assert.equal(randomCalls, 1);

    const featureBucket = getBucket({ feature: 'usePrecomputed' });
    assert.equal(featureBucket, 73, 'Feature bucket should inherit default by default');

    Math.random = () => {
      throw new Error('random should not be called when bucket is cached');
    };
    const secondBucket = getBucket();
    assert.equal(secondBucket, 73);

    const assignmentPayload = {
      default: 12,
      features: {
        usePrecomputed: { bucket: 7, source: 'backend' },
      },
      screens: {
        'item-details': 33,
      },
    };
    syncAssignments(assignmentPayload, { source: 'test-suite', now: () => new Date('2024-01-01T00:00:00.000Z') });
    const assignments = getAssignments();
    assert.equal(assignments.default.bucket, 12, 'Default assignment should update');
    assert.equal(assignments['feature:use-precomputed'].bucket, 7, 'Feature assignment should be persisted');
    assert.equal(assignments['screen:item-details'].bucket, 33, 'Screen assignment should be persisted');
    assert.equal(storage.getItem(ASSIGNMENTS_STORAGE_KEY) !== null, true, 'Assignments should be stored');

    const updatedDefault = getBucket();
    assert.equal(updatedDefault, 12, 'getBucket should reflect updated default assignment');
    const updatedFeature = getBucket({ feature: 'usePrecomputed' });
    assert.equal(updatedFeature, 7, 'Feature bucket should honour synced assignments');
    const updatedScreen = getBucket({ screen: 'item-details' });
    assert.equal(updatedScreen, 33, 'Screen bucket should honour synced assignments');

    const reloadedModule = await importFresh('../src/js/utils/canaryBucket.js', 'second-load');
    Math.random = () => {
      throw new Error('random should not be called after module reload with persisted bucket');
    };
    const thirdBucket = reloadedModule.getBucket();
    assert.equal(thirdBucket, 12, 'Reloaded module should reuse synced default bucket');

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
