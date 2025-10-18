const { MongoClient } = require('mongodb');
const { log } = require('./logger');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const SNAPSHOT_COLLECTION = process.env.SNAPSHOT_COLLECTION || 'apiMetrics';
const SNAPSHOT_ARCHIVE_COLLECTION = process.env.SNAPSHOT_ARCHIVE_COLLECTION || 'apiMetricsArchive';
const SNAPSHOT_RETENTION_DAYS = normalizePositiveInt(process.env.SNAPSHOT_RETENTION_DAYS, 7);
const SNAPSHOT_ARCHIVE_ENABLED = parseBooleanEnv(process.env.SNAPSHOT_ARCHIVE_ENABLED, true);

function normalizePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function parseBooleanEnv(value, defaultValue) {
  if (value == null) {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function archiveSnapshots(collection, archiveCollection, cutoff) {
  if (!SNAPSHOT_ARCHIVE_ENABLED) {
    return 0;
  }

  const pipeline = [
    { $match: { createdAt: { $lt: cutoff } } },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          statusCode: '$statusCode',
          stale: '$stale',
        },
        count: { $sum: 1 },
        avgDurationMs: { $avg: '$durationMs' },
        minDurationMs: { $min: '$durationMs' },
        maxDurationMs: { $max: '$durationMs' },
      },
    },
    {
      $group: {
        _id: '$_id.day',
        total: { $sum: '$count' },
        staleCount: {
          $sum: {
            $cond: [{ $ifNull: ['$_id.stale', false] }, '$count', 0],
          },
        },
        avgDurationMs: { $avg: '$avgDurationMs' },
        minDurationMs: { $min: '$minDurationMs' },
        maxDurationMs: { $max: '$maxDurationMs' },
        breakdown: {
          $push: {
            statusCode: '$_id.statusCode',
            stale: { $ifNull: ['$_id.stale', false] },
            count: '$count',
            avgDurationMs: '$avgDurationMs',
            minDurationMs: '$minDurationMs',
            maxDurationMs: '$maxDurationMs',
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        day: '$_id',
        total: { $ifNull: ['$total', 0] },
        staleCount: { $ifNull: ['$staleCount', 0] },
        avgDurationMs: '$avgDurationMs',
        minDurationMs: '$minDurationMs',
        maxDurationMs: '$maxDurationMs',
        breakdown: 1,
      },
    },
    { $sort: { day: 1 } },
  ];

  const aggregated = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
  if (!aggregated.length) {
    return 0;
  }

  const now = new Date();
  const operations = aggregated.map((doc) => {
    const breakdown = Array.isArray(doc.breakdown)
      ? doc.breakdown.map((entry) => ({
          statusCode: entry.statusCode ?? null,
          stale: Boolean(entry.stale),
          count: entry.count || 0,
          avgDurationMs: normalizeNumber(entry.avgDurationMs),
          minDurationMs: normalizeNumber(entry.minDurationMs),
          maxDurationMs: normalizeNumber(entry.maxDurationMs),
        }))
      : [];

    const total = doc.total || 0;
    const staleCount = doc.staleCount || 0;
    const payload = {
      day: doc.day,
      total,
      staleCount,
      staleRatio: total > 0 ? staleCount / total : null,
      avgDurationMs: normalizeNumber(doc.avgDurationMs),
      minDurationMs: normalizeNumber(doc.minDurationMs),
      maxDurationMs: normalizeNumber(doc.maxDurationMs),
      breakdown,
      archivedAt: now,
      retentionDays: SNAPSHOT_RETENTION_DAYS,
    };

    return {
      updateOne: {
        filter: { day: payload.day },
        update: { $set: payload },
        upsert: true,
      },
    };
  });

  if (!operations.length) {
    return 0;
  }

  await archiveCollection.bulkWrite(operations, { ordered: false });
  return operations.length;
}

async function cleanupSnapshots() {
  if (SNAPSHOT_RETENTION_DAYS <= 0) {
    log('[cleanup] retention disabled; skipping snapshot cleanup');
    return;
  }

  if (process.env.DRY_RUN) {
    log('[cleanup] DRY_RUN activo - limpieza de snapshots omitida');
    return;
  }

  const client = new MongoClient(MONGO_URL, { maxPoolSize: 4 });
  await client.connect();

  try {
    const db = client.db();
    const collection = db.collection(SNAPSHOT_COLLECTION);
    const archiveCollection = db.collection(SNAPSHOT_ARCHIVE_COLLECTION);
    const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    log(`[cleanup] iniciando limpieza de snapshots (retención ${SNAPSHOT_RETENTION_DAYS} días)`);
    const archivedDays = await archiveSnapshots(collection, archiveCollection, cutoff);
    const deleteResult = await collection.deleteMany({ createdAt: { $lt: cutoff } });
    const deleted = deleteResult?.deletedCount || 0;

    log(
      `[cleanup] snapshots archivados=${archivedDays}, eliminados=${deleted}, cutoff=${cutoff.toISOString()}`,
    );
  } catch (err) {
    log(`[cleanup] error: ${err.message}`);
    throw err;
  } finally {
    await client.close();
    log('[cleanup] limpieza de snapshots finalizada');
  }
}

module.exports = cleanupSnapshots;
