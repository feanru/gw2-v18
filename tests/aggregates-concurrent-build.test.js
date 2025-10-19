const assert = require('assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.AGGREGATE_WORKER_PRELOAD = path.resolve(
  __dirname,
  'helpers/aggregate-worker-preload.js',
);

const { sleep, createRedisMockState } = require('./fixtures/aggregate-worker-mocks.js');

const sharedCounter = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
global.__AGGREGATE_WORKER_SHARED__ = sharedCounter;

const redisState = createRedisMockState();
const redisPath = require.resolve('redis');
require.cache[redisPath] = {
  exports: {
    createClient: () => redisState.createClient(),
  },
};

async function testConcurrentBuildCoalescing() {
  const snapshotCache = require('../backend/utils/snapshotCache.js');
  snapshotCache.__private.clearLocal();
  redisState.redisStore.clear();
  redisState.redisExpiry.clear();
  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
  const aggregateModuleFirst = require('../backend/aggregates/buildItemAggregate.js');

  const firstPromise = aggregateModuleFirst.buildItemAggregate(1001, 'es');

  await sleep(30);

  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
  snapshotCache.__private.clearLocal();
  const aggregateModuleSecond = require('../backend/aggregates/buildItemAggregate.js');

  const secondPromise = aggregateModuleSecond.buildItemAggregate(1001, 'es');

  const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

  const counterView = new Int32Array(sharedCounter);
  assert.strictEqual(Atomics.load(counterView, 0), 1, 'expected only one build execution');
  assert.deepStrictEqual(firstResult, secondResult);
  assert.strictEqual(firstResult.meta.itemId, 1001);
  assert.strictEqual(secondResult.meta.itemId, 1001);
  assert.strictEqual(firstResult.meta.stale, false);
  assert.strictEqual(secondResult.meta.stale, false);

  console.log('tests/aggregates-concurrent-build.test.js coalescing passed');
}

async function testSnapshotCacheStaleMetadata() {
  const snapshotCache = require('../backend/utils/snapshotCache.js');
  snapshotCache.__private.clearLocal();
  redisState.redisStore.clear();
  redisState.redisExpiry.clear();
  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
  const aggregateModule = require('../backend/aggregates/buildItemAggregate.js');

  const itemId = 1001;
  const lang = 'es';
  const built = await aggregateModule.buildItemAggregate(itemId, lang);
  assert.ok(built?.meta, 'Debe construir un agregado inicial');

  const cacheKey = `agg:${lang}:${itemId}`;
  const envelope = snapshotCache.__private.localCache.get(cacheKey);
  assert.ok(envelope, 'Debe existir un sobre en cache');
  const now = Date.now();
  envelope.a = now - 60_000;
  envelope.r = now - 1_000;
  envelope.e = now + 120_000;

  const cached = await aggregateModule.getCachedAggregate(itemId, lang);
  assert.ok(cached, 'Debe recuperar el agregado desde cache');
  assert.strictEqual(cached.cache.stale, true, 'El cache debe marcarse como stale tras expirar el soft TTL');
  assert.strictEqual(cached.meta.stale, true, 'La metadata del agregado debe reflejar el estado stale');
  assert.ok(
    typeof cached.cache.ageMs === 'number' && cached.cache.ageMs >= 1000,
    'El metadata debe exponer la edad del cache',
  );
}

async function run() {
  await testConcurrentBuildCoalescing();
  await testSnapshotCacheStaleMetadata();
  console.log('tests/aggregates-concurrent-build.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
