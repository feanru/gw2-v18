#!/usr/bin/env node
'use strict';

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const INDEX_THRESHOLD_BYTES = Math.max(
  Number.parseInt(
    process.env.MONGO_ANALYZE_INDEX_THRESHOLD || process.env.ADMIN_INDEX_SIZE_ALERT_BYTES || '0',
    10,
  ) || 0,
  0,
);
const RAW_COLLECTIONS = process.env.ANALYZE_MONGO_COLLECTIONS || '';
const DEFAULT_COLLECTIONS = [
  process.env.ITEMS_COLLECTION || 'items',
  process.env.PRICES_COLLECTION || 'prices',
  process.env.RECIPES_COLLECTION || 'recipes',
  process.env.METRICS_COLLECTION || 'apiMetrics',
  process.env.JS_ERROR_COLLECTION || 'jsErrors',
  process.env.AGGREGATE_SNAPSHOT_COLLECTION || 'aggregateSnapshots',
].filter(Boolean);
const COLLECTIONS = Array.from(
  new Set(
    RAW_COLLECTIONS
      ? RAW_COLLECTIONS.split(',').map((name) => name.trim()).filter(Boolean)
      : DEFAULT_COLLECTIONS,
  ),
);
const OUTPUT_JSON = process.argv.includes('--json');

const QUERY_TEMPLATES = {
  items: [
    {
      name: 'by-id-lang',
      filter: { id: 1, lang: 'es' },
      options: { projection: { _id: 0, id: 1, lang: 1 } },
    },
    {
      name: 'tradable-lang',
      filter: { lang: 'en', tradable: true },
      options: { sort: { id: 1 }, limit: 5 },
    },
  ],
  prices: [
    {
      name: 'by-id',
      filter: { id: 1 },
      options: { projection: { _id: 0, id: 1 } },
    },
  ],
  recipes: [
    {
      name: 'by-output-id',
      filter: { output_item_id: 1 },
      options: { projection: { _id: 0, output_item_id: 1 } },
    },
  ],
  apiMetrics: [
    {
      name: 'aggregate-by-date',
      filter: { endpoint: 'aggregate', createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } },
      options: { sort: { createdAt: -1 }, limit: 10 },
    },
  ],
  jsErrors: [
    {
      name: 'recent-errors',
      filter: { receivedAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      options: { sort: { receivedAt: -1 }, limit: 10 },
    },
  ],
  aggregateSnapshots: [
    {
      name: 'latest-snapshot',
      filter: { itemId: 1, lang: 'es' },
      options: { sort: { snapshotAt: -1 }, limit: 1 },
    },
  ],
};

function getQueriesForCollection(name) {
  if (!name) {
    return [];
  }
  if (QUERY_TEMPLATES[name]) {
    return QUERY_TEMPLATES[name];
  }
  return [
    {
      name: 'by-timestamp',
      filter: { timestamp: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      options: { sort: { timestamp: -1 }, limit: 10 },
    },
  ];
}

async function analyzeCollection(db, name) {
  const collection = db.collection(name);
  const result = {
    collection: name,
    stats: null,
    explains: [],
    indexThresholdExceeded: false,
    error: null,
  };

  try {
    result.stats = await collection.stats();
  } catch (err) {
    if (err && (err.codeName === 'NamespaceNotFound' || err.code === 26)) {
      result.error = 'collection not found';
      return result;
    }
    result.error = err.message;
    return result;
  }

  if (
    INDEX_THRESHOLD_BYTES > 0 &&
    Number.isFinite(result.stats?.totalIndexSize) &&
    result.stats.totalIndexSize > INDEX_THRESHOLD_BYTES
  ) {
    result.indexThresholdExceeded = true;
  }

  const queries = getQueriesForCollection(name);
  for (const query of queries) {
    try {
      const cursor = collection.find(query.filter || {}, query.options || {});
      const explain = await cursor.explain('executionStats');
      result.explains.push({
        name: query.name,
        filter: query.filter,
        options: query.options,
        planSummary: explain.queryPlanner?.winningPlan?.plannerVersion,
        winningPlan: explain.queryPlanner?.winningPlan || null,
        executionStats: explain.executionStats || null,
      });
    } catch (err) {
      result.explains.push({
        name: query.name,
        filter: query.filter,
        options: query.options,
        error: err.message,
      });
    }
  }

  return result;
}

async function main() {
  const client = new MongoClient(MONGO_URL, { maxPoolSize: 2 });
  const report = [];
  try {
    await client.connect();
    const db = client.db();
    for (const name of COLLECTIONS) {
      const analysis = await analyzeCollection(db, name);
      report.push(analysis);
    }
  } catch (err) {
    console.error(`analyze-mongo: ${err.message}`);
    process.exitCode = 1;
  } finally {
    try {
      await client.close();
    } catch (err) {
      // ignore
    }
  }

  if (OUTPUT_JSON) {
    console.log(JSON.stringify({
      thresholdBytes: INDEX_THRESHOLD_BYTES,
      collections: report,
    }, null, 2));
    return;
  }

  for (const entry of report) {
    console.log(`\n# ${entry.collection}`);
    if (entry.error) {
      console.log(`  error: ${entry.error}`);
      continue;
    }
    const stats = entry.stats || {};
    console.log(`  count: ${stats.count ?? 'n/a'}`);
    console.log(`  storageSize: ${stats.storageSize ?? 'n/a'} bytes`);
    console.log(`  totalIndexSize: ${stats.totalIndexSize ?? 'n/a'} bytes`);
    if (entry.indexThresholdExceeded) {
      console.log(
        `  WARNING: totalIndexSize (${stats.totalIndexSize}) excede el umbral ${INDEX_THRESHOLD_BYTES} bytes`,
      );
    }
    if (Array.isArray(entry.explains)) {
      for (const explain of entry.explains) {
        console.log(`  - query: ${explain.name}`);
        if (explain.error) {
          console.log(`    error: ${explain.error}`);
          continue;
        }
        const winningPlan = explain.winningPlan?.stage || explain.winningPlan?.inputStage?.stage;
        const nReturned = explain.executionStats?.nReturned;
        const totalKeysExamined = explain.executionStats?.totalKeysExamined;
        const totalDocsExamined = explain.executionStats?.totalDocsExamined;
        console.log(`    plan: ${winningPlan || 'unknown'}`);
        console.log(`    keysExamined: ${totalKeysExamined ?? 'n/a'}`);
        console.log(`    docsExamined: ${totalDocsExamined ?? 'n/a'}`);
        console.log(`    nReturned: ${nReturned ?? 'n/a'}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
