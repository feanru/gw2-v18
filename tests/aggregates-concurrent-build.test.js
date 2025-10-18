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

async function run() {
  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
  const aggregateModuleFirst = require('../backend/aggregates/buildItemAggregate.js');

  const firstPromise = aggregateModuleFirst.buildItemAggregate(1001, 'es');

  await sleep(30);

  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
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

  console.log('tests/aggregates-concurrent-build.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
