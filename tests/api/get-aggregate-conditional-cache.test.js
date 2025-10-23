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
  const canaryAssignments = {
    list: [
      {
        scope: 'aggregate',
        bucket: 'beta',
        assignedAt: '2024-01-01T00:00:00.000Z',
        expiresAt: '2024-02-01T00:00:00.000Z',
        source: 'redis',
        feature: 'test-feature',
        screen: 'aggregate',
      },
    ],
    map: {},
    raw: null,
  };
  const expectedAssignments = [
    {
      scope: 'aggregate',
      bucket: 'beta',
      assignedAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-02-01T00:00:00.000Z',
      source: 'redis',
      feature: 'test-feature',
      screen: 'aggregate',
    },
  ];
  api.__setCanaryAssignmentsFetcher(async () => canaryAssignments);
  api.__setRedisClient({ isOpen: true });
  try {
    const snapshotAt = '2024-01-01T12:00:00.000Z';
    const state = {
      cached: {
        data: {
          item: { id: 555, name: 'Conditional Cache Item', lang: 'es' },
          tree: { id: 555, cost: 42 },
        },
        meta: {
          itemId: 555,
          lang: 'es',
          snapshotAt,
          generatedAt: '2024-01-01T12:00:01.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          stale: false,
          warnings: [],
          errors: [],
        },
      },
      getCalls: 0,
    };

    const context = {
      traceId: 'trace-aggregate-conditional',
      ts: '2024-01-01T12:01:00.000Z',
    };

    await withAggregateOverrides(
      {
        getCachedAggregate: async () => {
          state.getCalls += 1;
          return state.cached;
        },
        buildItemAggregate: async () => {
          throw new Error('build should not be called');
        },
        scheduleAggregateBuild: async () => {},
      },
      async () => {
        const requestFresh = createMockRequest(context);
        const responseFresh = createMockResponse(context);

        await api.handleGetAggregate(requestFresh, responseFresh, 555, 'es');

        assert.strictEqual(responseFresh.statusCode, 200);
        assert.ok(responseFresh.headers.ETag);
        assert.ok(responseFresh.headers['Last-Modified']);
        assert.strictEqual(
          responseFresh.headers['Cache-Control'],
          'no-store, no-cache, must-revalidate',
        );
        const payloadFresh = JSON.parse(responseFresh.body);
        assert.strictEqual(
          responseFresh.headers['X-Canary-Assignments'],
          JSON.stringify(expectedAssignments),
        );
        assert.strictEqual(payloadFresh.meta.snapshotAt, snapshotAt);
        assert.deepStrictEqual(payloadFresh.meta.canaryAssignments, expectedAssignments);
        const etag = responseFresh.headers.ETag;
        const lastModified = responseFresh.headers['Last-Modified'];

        const requestIfNoneMatch = createMockRequest(context, {
          headers: { 'if-none-match': etag },
        });
        const responseIfNoneMatch = createMockResponse(context);

        await api.handleGetAggregate(requestIfNoneMatch, responseIfNoneMatch, 555, 'es');

        assert.strictEqual(responseIfNoneMatch.statusCode, 304);
        assert.strictEqual(responseIfNoneMatch.headers.ETag, etag);
        assert.strictEqual(responseIfNoneMatch.headers['Last-Modified'], lastModified);
        assert.strictEqual(
          responseIfNoneMatch.headers['X-Canary-Assignments'],
          JSON.stringify(expectedAssignments),
        );
        assert.strictEqual(
          responseIfNoneMatch.headers['Cache-Control'],
          'no-store, no-cache, must-revalidate',
        );
        assert.strictEqual(responseIfNoneMatch.body, undefined);

        const requestIfModifiedSince = createMockRequest(context, {
          headers: { 'if-modified-since': lastModified },
        });
        const responseIfModifiedSince = createMockResponse(context);

        await api.handleGetAggregate(requestIfModifiedSince, responseIfModifiedSince, 555, 'es');

        assert.strictEqual(responseIfModifiedSince.statusCode, 304);
        assert.strictEqual(responseIfModifiedSince.headers.ETag, etag);
        assert.strictEqual(
          responseIfModifiedSince.headers['Last-Modified'],
          lastModified,
        );
        assert.strictEqual(
          responseIfModifiedSince.headers['X-Canary-Assignments'],
          JSON.stringify(expectedAssignments),
        );
        assert.strictEqual(
          responseIfModifiedSince.headers['Cache-Control'],
          'no-store, no-cache, must-revalidate',
        );
        assert.strictEqual(responseIfModifiedSince.body, undefined);

        assert.strictEqual(state.getCalls >= 3, true);
      },
    );
  } finally {
    api.__resetRecordAggregateMetric();
    api.__resetCanaryAssignmentsFetcher();
    api.__resetRedisClient();
  }

  console.log('tests/api/get-aggregate-conditional-cache.test.js passed');
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
