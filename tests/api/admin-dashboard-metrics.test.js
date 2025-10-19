const assert = require('assert');

process.env.NODE_ENV = 'test';

const api = require('../../backend/api/index.js');

function createDbStub(statuses) {
  const collections = {
    apiMetrics: {
      find: () => ({
        toArray: async () => [],
      }),
    },
    syncStatus: {
      find: () => ({
        toArray: async () => statuses,
      }),
    },
  };

  return {
    collection(name) {
      if (collections[name]) {
        return collections[name];
      }
      return {
        countDocuments: async () => 0,
        find: () => ({
          sort: () => ({
            limit: () => ({
              next: async () => null,
            }),
          }),
        }),
      };
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

  const clientStub = {
    db: () => createDbStub(statuses),
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

  try {
    const snapshot = await api.buildDashboardSnapshot();

    assert.ok(snapshot.jsErrors, 'jsErrors section should exist');
    assert.strictEqual(snapshot.jsErrors.count, 120);
    assert.strictEqual(snapshot.jsErrors.perMinute, 8);
    assert.strictEqual(snapshot.jsErrors.lastMessage, 'ReferenceError: boom');

    assert.ok(snapshot.delivery, 'delivery section should exist');
    assert.strictEqual(snapshot.delivery.ttfb.sampleCount, 0);
    assert.strictEqual(snapshot.delivery.payload.sampleCount, 0);

    const freshnessAge = snapshot.freshness.items.lastUpdatedAgeMinutes;
    assert.ok(freshnessAge >= 89, 'items freshness should be older than 89 minutes');

    const alertTypes = snapshot.alerts.map((alert) => alert.type);
    assert.ok(alertTypes.includes('freshness-stale'), 'should include freshness-stale alert');
    assert.ok(alertTypes.includes('js-error-rate'), 'should include js-error-rate alert');

    console.log('tests/api/admin-dashboard-metrics.test.js passed');
  } finally {
    api.__resetCollectJsErrorMetrics();
    api.__resetMongoClient();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
