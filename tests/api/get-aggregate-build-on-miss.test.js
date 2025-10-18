const assert = require('assert');
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
  try {
    const state = {
      cached: null,
      getCalls: 0,
      buildCalls: 0,
      scheduleCalls: 0,
    };

    const payload = {
      data: {
        item: { id: 12345, name: 'Sample Item', lang: 'es' },
        tree: { id: 12345, cost: 100 },
        totals: { cost: 100, sell: 150 },
      },
      meta: {
        itemId: 12345,
        lang: 'es',
        snapshotAt: '2024-01-01T00:00:00.000Z',
        generatedAt: '2024-01-01T00:00:00.000Z',
        durationMs: 250,
        expiresAt: '2099-01-01T00:05:00.000Z',
        stale: false,
        warnings: ['sampleWarning'],
        errors: [],
      },
    };

    await withAggregateOverrides(
      {
        getCachedAggregate: async () => {
          state.getCalls += 1;
          return state.cached;
        },
        buildItemAggregate: async () => {
          state.buildCalls += 1;
          state.cached = {
            data: payload.data,
            meta: { ...payload.meta },
          };
          return {
            data: payload.data,
            meta: { ...payload.meta },
          };
        },
        scheduleAggregateBuild: async () => {
          state.scheduleCalls += 1;
          return state.cached;
        },
      },
      async () => {
        const contextFirst = {
          traceId: 'trace-aggregate-first',
          ts: '2024-01-01T00:00:00.000Z',
        };
        const requestFirst = createMockRequest(contextFirst);
        const responseFirst = createMockResponse(contextFirst);

        await api.handleGetAggregate(requestFirst, responseFirst, 12345, 'es');

        assert.strictEqual(state.getCalls, 1);
        assert.strictEqual(state.buildCalls, 1);
        assert.strictEqual(state.scheduleCalls, 1);
        assert.strictEqual(responseFirst.statusCode, 200);
        const firstPayload = JSON.parse(responseFirst.body);
        assert.deepStrictEqual(firstPayload.data, payload.data);
        assert.strictEqual(firstPayload.meta.itemId, 12345);
        assert.strictEqual(firstPayload.meta.lang, 'es');
        assert.strictEqual(firstPayload.meta.snapshotAt, payload.meta.snapshotAt);
        assert.strictEqual(firstPayload.meta.source, 'aggregate');
        assert.strictEqual(firstPayload.meta.stale, false);
        assert.ok(Array.isArray(firstPayload.meta.warnings));
        assert.strictEqual(firstPayload.errors, undefined);

        const contextSecond = {
          traceId: 'trace-aggregate-second',
          ts: '2024-01-01T00:01:00.000Z',
        };
        const requestSecond = createMockRequest(contextSecond);
        const responseSecond = createMockResponse(contextSecond);

        await api.handleGetAggregate(requestSecond, responseSecond, 12345, 'es');

        assert.strictEqual(state.getCalls, 2);
        assert.strictEqual(state.buildCalls, 1);
        assert.strictEqual(state.scheduleCalls, 1);
        assert.strictEqual(responseSecond.statusCode, 200);
        const secondPayload = JSON.parse(responseSecond.body);
        assert.deepStrictEqual(secondPayload.data, payload.data);
        assert.strictEqual(secondPayload.meta.itemId, 12345);
        assert.strictEqual(secondPayload.meta.snapshotAt, payload.meta.snapshotAt);
        assert.strictEqual(secondPayload.meta.source, 'aggregate');
        assert.strictEqual(secondPayload.meta.stale, false);
        assert.ok(Array.isArray(secondPayload.meta.warnings));
        assert.strictEqual(secondPayload.errors, undefined);
      },
    );
  } finally {
    api.__resetRecordAggregateMetric();
  }

  console.log('tests/api/get-aggregate-build-on-miss.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
