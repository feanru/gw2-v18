const { MongoClient } = require('mongodb');
const { log } = require('./logger');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const SNAPSHOT_COLLECTION = process.env.SNAPSHOT_COLLECTION || 'apiMetrics';
const SNAPSHOT_ARCHIVE_COLLECTION = process.env.SNAPSHOT_ARCHIVE_COLLECTION || 'apiMetricsArchive';
const SNAPSHOT_RETENTION_DAYS = normalizePositiveInt(process.env.SNAPSHOT_RETENTION_DAYS, 7);
const SNAPSHOT_ARCHIVE_ENABLED = parseBooleanEnv(process.env.SNAPSHOT_ARCHIVE_ENABLED, true);
const JS_ERROR_HISTORY_COLLECTION = process.env.JS_ERROR_HISTORY_COLLECTION || 'jsErrors';
const JS_ERROR_BACKUP_COLLECTION = process.env.JS_ERROR_BACKUP_COLLECTION || 'jsErrorsArchive';
const JS_ERROR_RETENTION_DAYS = normalizeRetentionDays(
  process.env.JS_ERROR_RETENTION_DAYS,
  30,
);
const JS_ERROR_MIN_RETENTION_DAYS = normalizePositiveInt(
  process.env.JS_ERROR_MIN_RETENTION_DAYS,
  7,
);
const JS_ERROR_BACKUP_ENABLED = parseBooleanEnv(process.env.JS_ERROR_BACKUP_ENABLED, false);
const PRICE_HISTORY_COLLECTION = process.env.PRICE_HISTORY_COLLECTION || 'priceHistory';
const PRICE_HISTORY_BACKUP_COLLECTION =
  process.env.PRICE_HISTORY_BACKUP_COLLECTION || 'priceHistoryArchive';
const PRICE_HISTORY_RETENTION_DAYS = normalizeRetentionDays(
  process.env.PRICE_HISTORY_RETENTION_DAYS,
  90,
);
const PRICE_HISTORY_MIN_RETENTION_DAYS = normalizePositiveInt(
  process.env.PRICE_HISTORY_MIN_RETENTION_DAYS,
  14,
);
const PRICE_HISTORY_BACKUP_ENABLED = parseBooleanEnv(process.env.PRICE_HISTORY_BACKUP_ENABLED, false);

function normalizePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function normalizeRetentionDays(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num <= 0) {
    return 0;
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

function computeCutoff(retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return null;
  }
  const ms = retentionDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

async function backupDocuments({ cursor, backupCollection }) {
  if (!cursor) {
    return 0;
  }
  const bulkSize = 500;
  const now = new Date();
  let operations = [];
  let total = 0;
  for await (const doc of cursor) {
    if (!doc || typeof doc !== 'object') {
      continue;
    }
    const replacement = { ...doc, archivedAt: now };
    operations.push({
      replaceOne: {
        filter: { _id: doc._id },
        replacement,
        upsert: true,
      },
    });
    if (operations.length >= bulkSize) {
      await backupCollection.bulkWrite(operations, { ordered: false });
      total += operations.length;
      operations = [];
    }
  }
  if (operations.length) {
    await backupCollection.bulkWrite(operations, { ordered: false });
    total += operations.length;
  }
  return total;
}

async function cleanupHistoricalCollection(db, options) {
  const {
    name,
    retentionDays,
    minRetentionDays,
    dateField,
    backupEnabled,
    backupCollectionName,
  } = options;

  if (!name || !dateField) {
    return { name, skipped: true };
  }

  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    return { name, skipped: true };
  }

  if (retentionDays === 0) {
    log(`[cleanup] ${name}: retención deshabilitada; no se eliminarán documentos`);
    return { name, skipped: true };
  }

  if (Number.isFinite(minRetentionDays) && retentionDays < minRetentionDays) {
    log(
      `[cleanup] ${name}: retención ${retentionDays} días menor al mínimo permitido ${minRetentionDays}; se omite limpieza`,
    );
    return { name, skipped: true };
  }

  const cutoff = computeCutoff(retentionDays);
  if (!cutoff) {
    return { name, skipped: true };
  }

  const collection = db.collection(name);
  const filter = { [dateField]: { $lt: cutoff } };
  let archived = 0;

  if (backupEnabled && backupCollectionName) {
    const backupCollection = db.collection(backupCollectionName);
    try {
      const cursor = collection
        .find(filter)
        .sort({ [dateField]: 1 })
        .limit(50000);
      archived = await backupDocuments({ cursor, backupCollection });
    } catch (err) {
      if (err && err.codeName === 'NamespaceNotFound') {
        log(`[cleanup] ${name}: colección inexistente durante el respaldo; se omite`);
        return {
          name,
          skipped: true,
        };
      }
      log(`[cleanup] ${name}: error al respaldar documentos antiguos: ${err.message}`);
      throw err;
    }
  }

  let deleted = 0;
  try {
    const deleteResult = await collection.deleteMany(filter);
    deleted = deleteResult?.deletedCount || 0;
  } catch (err) {
    if (err && err.codeName === 'NamespaceNotFound') {
      log(`[cleanup] ${name}: colección inexistente; no se eliminaron documentos`);
      return { name, cutoff, deleted: 0, archived, backupEnabled };
    }
    throw err;
  }

  return {
    name,
    cutoff,
    deleted,
    archived,
    backupEnabled,
  };
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

    const historicalResults = [];
    const historicalConfigs = [
      {
        name: JS_ERROR_HISTORY_COLLECTION,
        retentionDays: JS_ERROR_RETENTION_DAYS,
        minRetentionDays: JS_ERROR_MIN_RETENTION_DAYS,
        dateField: 'receivedAt',
        backupEnabled: JS_ERROR_BACKUP_ENABLED,
        backupCollectionName: JS_ERROR_BACKUP_COLLECTION,
      },
      {
        name: PRICE_HISTORY_COLLECTION,
        retentionDays: PRICE_HISTORY_RETENTION_DAYS,
        minRetentionDays: PRICE_HISTORY_MIN_RETENTION_DAYS,
        dateField: 'timestamp',
        backupEnabled: PRICE_HISTORY_BACKUP_ENABLED,
        backupCollectionName: PRICE_HISTORY_BACKUP_COLLECTION,
      },
    ];

    for (const config of historicalConfigs) {
      try {
        const result = await cleanupHistoricalCollection(db, config);
        if (result) {
          historicalResults.push(result);
        }
      } catch (err) {
        log(`[cleanup] error al depurar ${config.name}: ${err.message}`);
        throw err;
      }
    }

    for (const result of historicalResults) {
      if (!result || result.skipped) {
        log(`[cleanup] ${result?.name || 'desconocido'}: limpieza omitida`);
        continue;
      }
      const cutoffInfo = result.cutoff ? result.cutoff.toISOString() : 'n/a';
      log(
        `[cleanup] ${result.name}: backup=${result.backupEnabled ? 'on' : 'off'}, archivados=${result.archived || 0}, eliminados=${result.deleted || 0}, cutoff=${cutoffInfo}`,
      );
    }
  } catch (err) {
    log(`[cleanup] error: ${err.message}`);
    throw err;
  } finally {
    await client.close();
    log('[cleanup] limpieza de snapshots finalizada');
  }
}

module.exports = cleanupSnapshots;
