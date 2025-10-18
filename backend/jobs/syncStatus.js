const FAILURE_HISTORY_LIMIT = Number(process.env.SYNC_FAILURE_HISTORY_LIMIT || 50);
const FAILURE_RETENTION_HOURS = Number(process.env.SYNC_FAILURE_RETENTION_HOURS || 168);

function getCollection(client) {
  return client.db().collection('syncStatus');
}

function normalizeDate(date) {
  return date instanceof Date ? date : new Date(date);
}

function buildRetentionCutoff() {
  if (!FAILURE_RETENTION_HOURS || FAILURE_RETENTION_HOURS <= 0) {
    return null;
  }
  const ms = FAILURE_RETENTION_HOURS * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

function trimErrorMessage(error) {
  if (!error) {
    return 'unknown error';
  }
  const message = typeof error === 'string' ? error : error.message || String(error);
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

async function getLastSync(client, name) {
  const record = await getCollection(client).findOne({ collection: name });
  if (!record) {
    return null;
  }
  if (record.lastSuccess) {
    return normalizeDate(record.lastSuccess);
  }
  if (record.lastSync) {
    return normalizeDate(record.lastSync);
  }
  return null;
}

async function setLastSync(client, name, date = new Date()) {
  const retentionCutoff = buildRetentionCutoff();
  const update = {
    $set: {
      collection: name,
      lastSync: date,
      lastSuccess: date,
      lastRun: date,
      updatedAt: new Date(),
      lastError: null,
    },
    $setOnInsert: { failures: [] },
  };
  if (retentionCutoff) {
    update.$pull = { failures: { at: { $lt: retentionCutoff } } };
  }
  await getCollection(client).updateOne(
    { collection: name },
    update,
    { upsert: true }
  );
}

async function recordFailure(client, name, error, date = new Date()) {
  const retentionCutoff = buildRetentionCutoff();
  const failureEntry = {
    at: date,
    error: trimErrorMessage(error),
  };
  const update = {
    $set: {
      collection: name,
      lastFailure: date,
      lastRun: date,
      updatedAt: new Date(),
      lastError: failureEntry.error,
    },
    $push: {
      failures: {
        $each: [failureEntry],
        $slice: -Math.max(FAILURE_HISTORY_LIMIT, 1),
      },
    },
  };
  if (retentionCutoff) {
    update.$pull = { failures: { at: { $lt: retentionCutoff } } };
  }
  await getCollection(client).updateOne(
    { collection: name },
    update,
    { upsert: true }
  );
}

async function getStatus(client, name) {
  return getCollection(client).findOne({ collection: name });
}

async function countFailuresSince(client, name, since) {
  const record = await getCollection(client).findOne(
    { collection: name },
    { projection: { failures: 1 } }
  );
  if (!record || !Array.isArray(record.failures)) {
    return 0;
  }
  const threshold = normalizeDate(since);
  return record.failures.filter(entry => {
    if (!entry || !entry.at) {
      return false;
    }
    const entryDate = normalizeDate(entry.at);
    return entryDate >= threshold;
  }).length;
}

module.exports = { getLastSync, setLastSync, recordFailure, getStatus, countFailuresSince };
