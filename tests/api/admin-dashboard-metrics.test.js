const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.ADMIN_INDEX_SIZE_ALERT_BYTES = '1024';

const { registerMockDeps } = require('../helpers/register-mock-deps.js');

const restoreDeps = registerMockDeps();

const api = require('../../backend/api/index.js');
const { createMetricsHandler } = require('../../backend/api/metrics.js');

function createDbStub(statuses, metricsEntries = [], webVitalEntries = []) {
  const statsMap = {
    items: { count: 120, storageSize: 4096, totalIndexSize: 4096, indexSizes: { itemIndex: 4096 } },
    prices: { count: 80, storageSize: 2048, totalIndexSize: 512 },
    recipes: { count: 60, storageSize: 1024, totalIndexSize: 384 },
    apiMetrics: { count: 0, storageSize: 512, totalIndexSize: 256 },
    aggregateSnapshots: { count: 12, storageSize: 1024, totalIndexSize: 128 },
    jsErrors: { count: 5, storageSize: 256, totalIndexSize: 64 },
  };

  function createCollection(name, overrides = {}) {
    const stats = statsMap[name] || { count: 0, storageSize: 0, totalIndexSize: 0 };
    return {
      countDocuments: async () => 0,
      find: () => ({
        sort: () => ({
          limit: () => ({
            next: async () => null,
          }),
        }),
      }),
      stats: async () => ({ ...stats }),
      ...overrides,
    };
  }

  const collections = {
    apiMetrics: createCollection('apiMetrics', {
      find: () => ({
        toArray: async () => metricsEntries,
      }),
    }),
    webVitals: createCollection('webVitals', {
      find: () => ({
        toArray: async () => webVitalEntries,
      }),
    }),
    syncStatus: {
      find: () => ({
        toArray: async () => statuses,
      }),
      stats: async () => ({ count: statuses.length, storageSize: 0, totalIndexSize: 0 }),
    },
    items: createCollection('items'),
    prices: createCollection('prices'),
    recipes: createCollection('recipes'),
    aggregateSnapshots: createCollection('aggregateSnapshots'),
    jsErrors: createCollection('jsErrors'),
  };

  return {
    collection(name) {
      if (collections[name]) {
        return collections[name];
      }
      return createCollection(name || 'unknown');
    },
  };
}

async function run() {
  const now = Date.now();
  const statuses = [
    {
      collection: 'items',
      lastSuccess: new Date(now - 90 * 60 * 1000),
      failures: [],
    },
    {
      collection: 'prices',
      lastSuccess: new Date(now - 10 * 60 * 1000),
      failures: [],
    },
    {
      collection: 'recipes',
      lastSuccess: new Date(now - 5 * 60 * 1000),
      failures: [],
    },
  ];

  const metricsEntries = [
    {
      endpoint: 'aggregate',
      stale: false,
      durationMs: 120,
      statusCode: 200,
      ttfbMs: 60,
      responseBytes: 4096,
      cacheHit: true,
      createdAt: new Date(now - 2 * 60 * 1000),
    },
    {
      endpoint: 'aggregate',
      stale: true,
      durationMs: 240,
      statusCode: 200,
      ttfbMs: 110,
      responseBytes: 8192,
      cacheMiss: true,
      createdAt: new Date(now - 60 * 1000),
    },
    {
      endpoint: 'aggregate',
      stale: false,
      durationMs: 180,
      statusCode: 304,
      ttfbMs: 80,
      responseBytes: 2048,
      cacheHit: true,
      createdAt: new Date(now - 30 * 1000),
    },
    {
      endpoint: 'item-fallback',
      stale: false,
      durationMs: 90,
      statusCode: 200,
      createdAt: new Date(now - 45 * 1000),
    },
  ];

  const webVitalEntries = [
    {
      metric: 'LCP',
      value: 2100,
      rating: 'good',
      createdAt: new Date(now - 20 * 1000),
    },
    {
      metric: 'CLS',
      value: 0.05,
      rating: 'good',
      createdAt: new Date(now - 18 * 1000),
    },
    {
      metric: 'INP',
      value: 180,
      rating: 'needsImprovement',
      createdAt: new Date(now - 15 * 1000),
    },
  ];

  const clientStub = {
    db: () => createDbStub(statuses, metricsEntries, webVitalEntries),
  };

  api.__setMongoClient(clientStub);
  api.__setCollectJsErrorMetrics(async () => ({
    windowMinutes: 15,
    count: 120,
    perMinute: 8,
    lastErrorAt: new Date(now - 30 * 1000).toISOString(),
    lastMessage: 'ReferenceError: boom',
    lastSource: 'bundle.js',
    lastFingerprint: 'abc123',
    top: [
      {
        fingerprint: 'abc123',
        count: 75,
        message: 'ReferenceError: boom',
        source: 'bundle.js',
        lastErrorAt: new Date(now - 30 * 1000).toISOString(),
      },
    ],
  }));

  const redisStub = {
    async ping() {
      return 'PONG';
    },
    async info() {
      return ['# Server', 'redis_version:7.0.0', '# Memory', 'used_memory:2048', '# Clients', 'connected_clients:5'].join('\n');
    },
    async get(key) {
      if (key === 'telemetry:swCacheMetrics') {
        return JSON.stringify({ hit: 5, miss: 2, stale: 1, lastUpdated: now - 5_000 });
      }
      return null;
    },
  };
  api.__setRedisClient(redisStub);

  try {
    const snapshot = await api.buildDashboardSnapshot();

    assert.ok(snapshot.jsErrors, 'jsErrors section should exist');
    assert.strictEqual(snapshot.jsErrors.count, 120);
    assert.strictEqual(snapshot.jsErrors.perMinute, 8);
    assert.strictEqual(snapshot.jsErrors.lastMessage, 'ReferenceError: boom');
    assert.strictEqual(snapshot.responses.notModified, 1);
    assert.ok(snapshot.responses.bytesPerVisit > 0, 'bytes per visit should be calculated');
    assert.ok(Number.isFinite(snapshot.latency.p50), 'latency p50 should be available');
    assert.ok(Number.isFinite(snapshot.ttfb.p50), 'ttfb p50 should be available');
    assert.ok(Number.isFinite(snapshot.payload.p50Bytes), 'payload p50 should be available');
    assert.ok(Number.isFinite(snapshot.payload.totalBytes), 'payload total bytes should be tracked');

    const freshnessAge = snapshot.freshness.items.lastUpdatedAgeMinutes;
    assert.ok(freshnessAge >= 89, 'items freshness should be older than 89 minutes');

    const alertTypes = snapshot.alerts.map((alert) => alert.type);
    assert.ok(alertTypes.includes('freshness-stale'), 'should include freshness-stale alert');
    assert.ok(alertTypes.includes('js-error-rate'), 'should include js-error-rate alert');
    assert.ok(alertTypes.includes('mongo-index-footprint'), 'should include mongo-index-footprint alert');

    assert.ok(snapshot.mongo, 'mongo section should exist');
    assert.strictEqual(snapshot.mongo.indexStats.items.exceeded, true);
    assert.ok(snapshot.endpoints, 'endpoint metrics should exist');
    assert.strictEqual(snapshot.endpoints.aggregate.responses.total, 3);
    assert.ok(
      snapshot.endpoints['item-fallback'],
      'item-fallback endpoint metrics should be present even with few samples',
    );
    assert.ok(snapshot.webVitals.metrics.LCP, 'LCP metric should be summarized in webVitals');
    assert.ok(
      snapshot.webVitals.metrics.CLS.goodPercentage >= 0,
      'CLS metric should expose goodPercentage',
    );

    const metricsHandler = createMetricsHandler({
      buildDashboardSnapshot: async () => snapshot,
      getRedisClient: async () => redisStub,
      now: () => new Date(now),
      serviceWorkerMetricsKey: 'telemetry:swCacheMetrics',
    });

    const metricsReq = { method: 'GET', url: '/metrics', headers: {} };
    const metricsRes = {
      statusCode: null,
      headers: {},
      body: '',
      writeHead(code, incomingHeaders = {}) {
        this.statusCode = code;
        Object.assign(this.headers, incomingHeaders);
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(chunk) {
        if (Buffer.isBuffer(chunk)) {
          this.body = chunk.toString('utf8');
        } else if (typeof chunk === 'string') {
          this.body = chunk;
        } else if (chunk == null) {
          this.body = '';
        } else {
          this.body = String(chunk);
        }
      },
    };

    await metricsHandler(metricsReq, metricsRes);
    assert.strictEqual(metricsRes.statusCode, 200, 'metrics handler should respond 200');
    assert.ok(
      typeof metricsRes.headers['Content-Type'] === 'string' &&
        metricsRes.headers['Content-Type'].startsWith('text/plain'),
      'metrics handler should set text/plain content type',
    );
    assert.ok(
      metricsRes.body.includes('gw2_js_errors_total 120'),
      'metrics payload should include js error count',
    );
    assert.ok(
      metricsRes.body.includes('gw2_service_worker_cache_total{type="hit"} 5'),
      'metrics payload should include service worker cache hits',
    );
    assert.ok(
      metricsRes.body.includes('gw2_redis_up 1'),
      'metrics payload should report redis availability',
    );
    assert.ok(
      metricsRes.body.includes('gw2_api_latency_p50_ms'),
      'metrics payload should include latency p50',
    );
    assert.ok(
      metricsRes.body.includes('gw2_api_ttfb_p50_ms'),
      'metrics payload should include ttfb p50',
    );
    assert.ok(
      metricsRes.body.includes('gw2_api_payload_p50_bytes'),
      'metrics payload should include payload p50 bytes',
    );
    assert.ok(
      metricsRes.body.includes('gw2_api_responses_not_modified_total'),
      'metrics payload should include not modified total metric',
    );
    assert.ok(
      metricsRes.body.includes('gw2_api_bytes_per_visit'),
      'metrics payload should include bytes per visit metric',
    );
    assert.ok(
      metricsRes.body.includes('gw2_api_endpoint_latency_p95_ms{endpoint="aggregate"}'),
      'metrics payload should include per-endpoint latency metric',
    );
    assert.ok(
      metricsRes.body.includes('gw2_api_endpoint_cache_hit_percentage{endpoint="aggregate"}'),
      'metrics payload should include per-endpoint cache percentage',
    );
    assert.ok(
      metricsRes.body.includes('gw2_web_vital_samples_total{metric="LCP"}'),
      'metrics payload should include Core Web Vitals samples',
    );
    const bytesPerVisitLine = metricsRes.body
      .split('\n')
      .find((line) => line.startsWith('gw2_api_bytes_per_visit '));
    assert.ok(bytesPerVisitLine, 'bytes per visit metric line should be present');
    const bytesPerVisitValue = Number(bytesPerVisitLine.split(' ').pop());
    assert.ok(Number.isFinite(bytesPerVisitValue), 'bytes per visit metric should be numeric');
    assert.ok(bytesPerVisitValue > 0, 'bytes per visit metric should be greater than zero');

    console.log('tests/api/admin-dashboard-metrics.test.js passed');
  } finally {
    api.__resetCollectJsErrorMetrics();
    api.__resetMongoClient();
    api.__resetRedisClient();
  }
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
