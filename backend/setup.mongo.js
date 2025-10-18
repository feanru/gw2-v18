const { MongoClient } = require('mongodb');

const url = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';

async function ensureIndexes() {
  const client = new MongoClient(url);
  try {
    await client.connect();
    const db = client.db();

    const items = db.collection('items');
    await items.createIndex({ id: 1 });
    await items.createIndex({ lang: 1 });
    await items.createIndex({ tradable: 1 });

    const recipes = db.collection('recipes');
    await recipes.createIndex({ output_item_id: 1 });
    await recipes.createIndex({ input_item_id: 1 });

    const prices = db.collection('prices');
    await prices.createIndex({ id: 1 });
    await prices.createIndex({ lang: 1 });

    const metrics = db.collection('apiMetrics');
    const retentionDays = Number.parseInt(process.env.SNAPSHOT_RETENTION_DAYS || '7', 10);
    const ttlSeconds = Number.isFinite(retentionDays) && retentionDays > 0
      ? retentionDays * 24 * 60 * 60
      : 7 * 24 * 60 * 60;
    const existingIndexes = await metrics.indexes();
    for (const index of existingIndexes) {
      const isCreatedAtIndex =
        index.key && index.key.createdAt === 1 && Object.keys(index.key).length === 1;
      if (!isCreatedAtIndex) {
        continue;
      }
      const needsDrop = index.name !== 'apiMetrics_createdAt_ttl' || index.expireAfterSeconds !== ttlSeconds;
      if (needsDrop) {
        try {
          await metrics.dropIndex(index.name);
        } catch (err) {
          if (err.codeName !== 'IndexNotFound') {
            throw err;
          }
        }
      }
    }
    await metrics.createIndex({ createdAt: 1 }, {
      expireAfterSeconds: ttlSeconds,
      name: 'apiMetrics_createdAt_ttl',
    });
    await metrics.createIndex({ endpoint: 1, createdAt: 1 });

    const metricsArchive = db.collection('apiMetricsArchive');
    await metricsArchive.createIndex({ day: 1 }, { unique: true });
    await metricsArchive.createIndex({ archivedAt: 1 });

    const jsErrors = db.collection('jsErrors');
    const jsErrorRetentionDays = Number.parseInt(process.env.JS_ERROR_RETENTION_DAYS || '30', 10);
    const jsErrorTtlSeconds = Number.isFinite(jsErrorRetentionDays) && jsErrorRetentionDays > 0
      ? jsErrorRetentionDays * 24 * 60 * 60
      : 30 * 24 * 60 * 60;
    const jsErrorIndexes = await jsErrors.indexes();
    for (const index of jsErrorIndexes) {
      const isReceivedAtIndex =
        index.key && index.key.receivedAt === 1 && Object.keys(index.key).length === 1;
      if (!isReceivedAtIndex) {
        continue;
      }
      const needsDrop = index.name !== 'jsErrors_receivedAt_ttl' || index.expireAfterSeconds !== jsErrorTtlSeconds;
      if (needsDrop) {
        try {
          await jsErrors.dropIndex(index.name);
        } catch (err) {
          if (err.codeName !== 'IndexNotFound') {
            throw err;
          }
        }
      }
    }
    await jsErrors.createIndex({ receivedAt: 1 }, {
      expireAfterSeconds: jsErrorTtlSeconds,
      name: 'jsErrors_receivedAt_ttl',
    });
    await jsErrors.createIndex({ occurredAt: -1 });
    await jsErrors.createIndex({ fingerprint: 1, receivedAt: -1 });

    const jsErrorStats = db.collection('jsErrorStats');
    await jsErrorStats.createIndex({ updatedAt: -1 });
    await jsErrorStats.createIndex({ fingerprint: 1 }, {
      partialFilterExpression: { fingerprint: { $exists: true } },
    });

    console.log('MongoDB indices ensured');
  } finally {
    await client.close();
  }
}

ensureIndexes().catch(err => {
  console.error('Failed to create indexes', err);
  process.exit(1);
});
