const assert = require('assert');

process.env.NODE_ENV = 'test';

const { createRedisMockState } = require('./fixtures/aggregate-worker-mocks.js');

const createdWorkers = [];

class MockWorker {
  constructor(filename, options = {}) {
    this.filename = filename;
    this.options = options;
    this.listeners = new Map();
    createdWorkers.push(this);

    const behavior = process.env.MOCK_WORKER_BEHAVIOR || 'success';
    if (behavior === 'success') {
      setImmediate(() => {
        this.emit('message', {
          ok: true,
          payload: {
            meta: {
              itemId: options.workerData.itemId,
              lang: options.workerData.lang,
              stale: false,
              warnings: [],
              errors: [],
            },
            data: {
              item: null,
              tree: null,
              totals: { buy: 0, sell: 0, crafted: 0 },
            },
          },
        });
      });
    }
  }

  once(event, handler) {
    this.listeners.set(event, handler);
  }

  emit(event, value) {
    const handler = this.listeners.get(event);
    if (handler) {
      this.listeners.delete(event);
      handler(value);
    }
  }

  terminate() {
    const exitHandler = this.listeners.get('exit');
    if (exitHandler) {
      this.listeners.delete('exit');
      exitHandler(0);
    }
    return Promise.resolve();
  }

  removeAllListeners() {
    this.listeners.clear();
  }
}

const workerThreadsPath = require.resolve('worker_threads');
require.cache[workerThreadsPath] = { exports: { Worker: MockWorker } };

const redisState = createRedisMockState();
const redisPath = require.resolve('redis');
require.cache[redisPath] = {
  exports: {
    createClient: () => redisState.createClient(),
  },
};

async function runTimeoutScenario() {
  process.env.MAX_AGGREGATION_MS = '20';
  process.env.AGGREGATE_MAX_OLD_MB = '1';
  process.env.AGGREGATE_MAX_YOUNG_MB = '1';
  process.env.MOCK_WORKER_BEHAVIOR = 'timeout';
  createdWorkers.length = 0;
  global.__AGGREGATE_WORKER_SHARED__ = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);

  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
  const aggregateModule = require('../backend/aggregates/buildItemAggregate.js');

  try {
    await aggregateModule.buildItemAggregate(1001, 'es');
    assert.fail('expected AGGREGATION_TIMEOUT');
  } catch (err) {
    assert.strictEqual(err && err.code, 'AGGREGATION_TIMEOUT');
  }

  const worker = createdWorkers[0];
  assert.ok(worker, 'worker should be instantiated');
  assert.deepStrictEqual(worker.options.resourceLimits, {
    maxOldGenerationSizeMb: 1,
    maxYoungGenerationSizeMb: 1,
  });
}

async function runSuccessScenario() {
  delete process.env.AGGREGATE_MAX_OLD_MB;
  delete process.env.AGGREGATE_MAX_YOUNG_MB;
  process.env.MAX_AGGREGATION_MS = '200';
  process.env.MOCK_WORKER_BEHAVIOR = 'success';
  createdWorkers.length = 0;
  delete global.__AGGREGATE_WORKER_SHARED__;

  delete require.cache[require.resolve('../backend/aggregates/buildItemAggregate.js')];
  const aggregateModule = require('../backend/aggregates/buildItemAggregate.js');

  const result = await aggregateModule.buildItemAggregate(55, 'es');
  assert.strictEqual(result.meta.itemId, 55);
  assert.strictEqual(result.meta.lang, 'es');
  assert.strictEqual(Array.isArray(result.meta.warnings), true);

  const worker = createdWorkers[0];
  assert.ok(worker, 'worker should be created for success scenario');
  assert.strictEqual(worker.options.resourceLimits, undefined);
}

(async () => {
  try {
    await runTimeoutScenario();
    await runSuccessScenario();
    process.stdout.write('tests/aggregates-worker-limits.test.js passed\n');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
