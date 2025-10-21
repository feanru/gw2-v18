const { MongoClient } = require('mongodb');

const url = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const aggregateSnapshotCollectionName =
  process.env.AGGREGATE_SNAPSHOT_COLLECTION || 'aggregateSnapshots';
const aggregateSnapshotRetentionDays = Number.parseInt(
  process.env.AGGREGATE_SNAPSHOT_RETENTION_DAYS || '90',
  10,
);
const operationalEventCollectionName =
  process.env.OPERATIONAL_EVENT_COLLECTION || 'operationalEvents';
const operationalEventRetentionDays = Number.parseInt(
  process.env.OPERATIONAL_EVENT_RETENTION_DAYS || '30',
  10,
);

function normalizeTtlSeconds(days, fallbackDays) {
  const parsed = Number.isFinite(days) ? days : Number(fallbackDays);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed * 24 * 60 * 60);
}

async function ensureNamedIndex(collection, spec, options = {}) {
  const indexes = await collection.indexes();
  const existing = indexes.find((index) => index.name === options.name);
  const desiredExpire = Object.prototype.hasOwnProperty.call(options, 'expireAfterSeconds')
    ? options.expireAfterSeconds
    : null;
  const desiredPartial = options.partialFilterExpression || null;
  const desiredUnique = Boolean(options.unique);
  const normalizedOptions = { ...options };
  if (normalizedOptions.expireAfterSeconds == null) {
    delete normalizedOptions.expireAfterSeconds;
  }
  if (!normalizedOptions.partialFilterExpression) {
    delete normalizedOptions.partialFilterExpression;
  }
  if (!desiredUnique) {
    delete normalizedOptions.unique;
  }

  if (existing) {
    const existingExpire = Object.prototype.hasOwnProperty.call(existing, 'expireAfterSeconds')
      ? existing.expireAfterSeconds
      : null;
    const existingPartial = existing.partialFilterExpression || null;
    const existingUnique = Boolean(existing.unique);
    const sameExpire = existingExpire === desiredExpire;
    const samePartial = JSON.stringify(existingPartial || null) === JSON.stringify(desiredPartial || null);
    const sameUnique = existingUnique === desiredUnique;
    if (!sameExpire || !samePartial || !sameUnique) {
      try {
        await collection.dropIndex(existing.name);
      } catch (err) {
        if (err && err.codeName !== 'IndexNotFound') {
          throw err;
        }
      }
    } else {
      return;
    }
  }

  await collection.createIndex(spec, normalizedOptions);
}

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

    const aggregateSnapshots = db.collection(aggregateSnapshotCollectionName);
    await ensureNamedIndex(
      aggregateSnapshots,
      { itemId: 1, lang: 1 },
      {
        unique: true,
        name: 'aggregateSnapshots_item_lang_unique',
      },
    );
    const aggregateSnapshotTtlSeconds = normalizeTtlSeconds(
      aggregateSnapshotRetentionDays,
      90,
    );
    await ensureNamedIndex(
      aggregateSnapshots,
      { itemId: 1, lang: 1, snapshotAt: -1 },
      {
        name: 'aggregateSnapshots_item_lang_snapshotAt',
        partialFilterExpression: { snapshotAt: { $exists: true } },
        expireAfterSeconds: aggregateSnapshotTtlSeconds,
      },
    );

    const operationalEvents = db.collection(operationalEventCollectionName);
    const operationalEventTtlSeconds = normalizeTtlSeconds(
      operationalEventRetentionDays,
      30,
    );
    await ensureNamedIndex(
      operationalEvents,
      { type: 1, timestamp: -1 },
      {
        name: 'operationalEvents_type_timestamp',
        partialFilterExpression: { timestamp: { $exists: true } },
        expireAfterSeconds: operationalEventTtlSeconds,
      },
    );

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
