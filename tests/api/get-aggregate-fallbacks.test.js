const assert = require('assert');
const { registerMockDeps } = require('../helpers/register-mock-deps.js');

const restoreDeps = registerMockDeps();

const api = require('../../backend/api/index.js');

process.env.NODE_ENV = 'test';

function createMockResponse(context = {}) {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    __responseContext: { ...context },
    writeHead(statusCode, incomingHeaders) {
      this.statusCode = statusCode;
      Object.assign(this.headers, incomingHeaders);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

function createMockRequest(context = {}, overrides = {}) {
  return {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '',
    headers: { ...(overrides.headers || {}) },
    __responseContext: { ...context },
  };
}

async function withAggregateOverrides(overrides, fn) {
  api.__setAggregateOverrides(overrides);
  try {
    await fn();
  } finally {
    api.__resetAggregateOverrides();
  }
}

async function run() {
  api.__setRecordAggregateMetric(async () => {});
  api.__setCanaryAssignmentsFetcher(async () => ({ list: [], map: {}, raw: null }));
  api.__setRedisClient({ isOpen: true });
  try {
    const context = {
      traceId: 'trace-aggregate-missing',
      ts: '2024-01-01T00:00:00.000Z',
    };
    const requestMissing = createMockRequest(context);
    const responseMissing = createMockResponse(context);
    const scheduled = { count: 0 };

    await withAggregateOverrides(
      {
        getCachedAggregate: async () => null,
        buildItemAggregate: async () => {
          throw new Error('build failed');
        },
        scheduleAggregateBuild: async () => {
          scheduled.count += 1;
          throw new Error('scheduled build failed');
        },
      },
      async () => {
        await api.handleGetAggregate(requestMissing, responseMissing, 12345, 'es');
      },
    );

    assert.strictEqual(responseMissing.statusCode, 200);
    const missingPayload = JSON.parse(responseMissing.body);
    assert.strictEqual(missingPayload.data, null);
    assert.ok(Array.isArray(missingPayload.errors));
    assert.strictEqual(missingPayload.errors[0].code, 'aggregate_failed');
    assert.strictEqual(missingPayload.errors[0].msg, 'Aggregate snapshot not available');
    assert.strictEqual(missingPayload.meta.lang, 'es');
    assert.strictEqual(missingPayload.meta.itemId, 12345);
    assert.strictEqual(missingPayload.meta.stale, false);
    assert.strictEqual(missingPayload.meta.lastUpdated, null);
    assert.strictEqual(scheduled.count > 0, true);

    const responseError = createMockResponse({
      traceId: 'trace-aggregate-error',
      ts: '2024-01-02T00:00:00.000Z',
    });
    const requestError = createMockRequest({
      traceId: 'trace-aggregate-error',
      ts: '2024-01-02T00:00:00.000Z',
    });

    await withAggregateOverrides(
      {
        getCachedAggregate: async () => {
          throw new Error('boom');
        },
        scheduleAggregateBuild: async () => {},
      },
      async () => {
        await api.handleGetAggregate(requestError, responseError, 67890, 'en');
      },
    );

    assert.strictEqual(responseError.statusCode, 200);
    const errorPayload = JSON.parse(responseError.body);
    assert.strictEqual(errorPayload.data, null);
    assert.ok(Array.isArray(errorPayload.errors));
    assert.strictEqual(errorPayload.errors[0].code, 'aggregate_failed');
    assert.strictEqual(errorPayload.errors[0].msg, 'Aggregate snapshot not available');
    assert.strictEqual(errorPayload.meta.lang, 'en');
    assert.strictEqual(errorPayload.meta.itemId, 67890);
    assert.strictEqual(errorPayload.meta.stale, false);
    assert.strictEqual(errorPayload.meta.lastUpdated, null);

    const staleContext = {
      traceId: 'trace-aggregate-stale',
      ts: '2024-01-03T00:00:00.000Z',
    };
    const responseStale = createMockResponse(staleContext);
    const requestStale = createMockRequest(staleContext);
    const staleSnapshotAt = '2024-01-02T23:59:00.000Z';

    await withAggregateOverrides(
      {
        getCachedAggregate: async () => ({
          data: {
            item: { id: 54321, name: 'Cached Item', lang: 'en' },
          },
          meta: {
            itemId: 54321,
            lang: 'en',
            snapshotAt: staleSnapshotAt,
            generatedAt: staleSnapshotAt,
            expiresAt: '2024-01-02T23:58:00.000Z',
            stale: false,
            warnings: [],
            errors: [],
          },
        }),
        buildItemAggregate: async () => {
          throw new Error('build should not run');
        },
        scheduleAggregateBuild: async () => {},
        isAggregateExpired: () => true,
      },
      async () => {
        await api.handleGetAggregate(requestStale, responseStale, 54321, 'en');
      },
    );

    assert.strictEqual(responseStale.statusCode, 200);
    const stalePayload = JSON.parse(responseStale.body);
    assert.deepStrictEqual(stalePayload.data, {
      item: { id: 54321, name: 'Cached Item', lang: 'en' },
    });
    assert.strictEqual(stalePayload.meta.itemId, 54321);
    assert.strictEqual(stalePayload.meta.lang, 'en');
    assert.strictEqual(stalePayload.meta.snapshotAt, staleSnapshotAt);
    assert.strictEqual(stalePayload.meta.stale, true);
    assert.ok(Array.isArray(stalePayload.meta.warnings));
  } finally {
    api.__resetRecordAggregateMetric();
    api.__resetCanaryAssignmentsFetcher();
    api.__resetRedisClient();
  }

  console.log('tests/api/get-aggregate-fallbacks.test.js passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (typeof restoreDeps === 'function') {
      restoreDeps();
    }
  });
