const { getStatus } = require('./syncStatus');

async function countDocuments(collection) {
  try {
    return await collection.countDocuments();
  } catch (err) {
    if (err && err.codeName === 'NamespaceNotFound') {
      return 0;
    }
    throw err;
  }
}

async function findLatestUpdate(collection) {
  try {
    const cursor = collection
      .find({}, { projection: { lastUpdated: 1 } })
      .sort({ lastUpdated: -1 })
      .limit(1);
    const doc = await cursor.next();
    return doc ? doc.lastUpdated : null;
  } catch (err) {
    if (err && err.codeName === 'NamespaceNotFound') {
      return null;
    }
    throw err;
  }
}

function computeFailures24h(status) {
  if (!status || !Array.isArray(status.failures)) {
    return 0;
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return status.failures.filter((entry) => {
    if (!entry || !entry.at) {
      return false;
    }
    const timestamp = entry.at instanceof Date ? entry.at.getTime() : new Date(entry.at).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  }).length;
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

async function buildCollectionSummary(client, collectionName) {
  const db = client.db();
  const collection = db.collection(collectionName);
  const [count, latestDoc, status] = await Promise.all([
    countDocuments(collection),
    findLatestUpdate(collection),
    getStatus(client, collectionName),
  ]);

  const lastUpdated = latestDoc || (status ? status.lastSuccess || status.lastSync : null);
  return {
    count,
    lastUpdated: toIsoOrNull(lastUpdated),
    failures24h: computeFailures24h(status),
    lastSuccessAt: toIsoOrNull(status?.lastSuccess),
    lastFailureAt: toIsoOrNull(status?.lastFailure),
  };
}

async function buildSyncHealthPayload(client) {
  const [items, prices, recipes, recipeTrees] = await Promise.all([
    buildCollectionSummary(client, 'items'),
    buildCollectionSummary(client, 'prices'),
    buildCollectionSummary(client, 'recipes'),
    buildCollectionSummary(client, 'recipeTrees'),
  ]);

  return {
    items,
    prices,
    recipes,
    recipeTrees,
  };
}

module.exports = {
  countDocuments,
  findLatestUpdate,
  computeFailures24h,
  toIsoOrNull,
  buildCollectionSummary,
  buildSyncHealthPayload,
};
