const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { log } = require('./logger');
const { getLastSync, setLastSync, recordFailure } = require('./syncStatus');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const API_URL = 'https://api.guildwars2.com/v2/recipes';
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 500;
const DEFAULT_LANG = (process.env.DEFAULT_LANG || 'es').trim() || 'es';

async function fetchRecipes(lang) {
  const idsParam = process.env.RECIPE_IDS || 'all';
  const url = new URL(API_URL);
  url.searchParams.set('ids', idsParam);
  if (lang) {
    url.searchParams.set('lang', lang);
  }
  const res = await fetch(url.href);
  if (!res.ok) {
    throw new Error(`Failed to fetch recipes: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response format when fetching recipes');
  }
  return data;
}

async function updateRecipes() {
  const mongo = new MongoClient(MONGO_URL);
  const redis = createClient({ url: REDIS_URL });

  await mongo.connect();
  await redis.connect();

  try {
    log('[recipes] job started');
    if (process.env.DRY_RUN) {
      log('[recipes] DRY_RUN active - skipping fetch');
      await setLastSync(mongo, 'recipes');
      return;
    }
    const lastSync = await getLastSync(mongo, 'recipes');
    if (lastSync) log(`[recipes] last sync ${lastSync.toISOString()}`);
    const recipes = await fetchRecipes(DEFAULT_LANG);
    const collection = mongo.db().collection('recipes');
    const ops = [];
    let pipeline = redis.multi();
    let processed = 0;
    const start = Date.now();
    const timestamp = new Date();

    async function flush() {
      if (!ops.length) return;
      const flushStart = Date.now();
      await Promise.all([
        collection.bulkWrite(ops),
        pipeline.exec(),
      ]);
      const duration = Date.now() - flushStart;
      processed += ops.length;
      log(`[recipes] processed ${ops.length} operations in ${duration}ms`);
      ops.length = 0;
      pipeline = redis.multi();
    }

    for (const recipe of recipes) {
      if (!recipe || typeof recipe.id === 'undefined') {
        continue;
      }
      const document = {
        ...recipe,
        lang: DEFAULT_LANG,
        source: 'external',
        lastUpdated: new Date(timestamp),
      };
      ops.push({
        updateOne: {
          filter: { id: recipe.id },
          update: { $set: document },
          upsert: true,
        },
      });
      pipeline.hSet('recipes', String(recipe.id), JSON.stringify(document));
      if (ops.length >= BATCH_SIZE) await flush();
    }
    await flush();

    await setLastSync(mongo, 'recipes', timestamp);
    const totalDuration = Date.now() - start;
    log(`[recipes] upserted ${processed} documents in ${totalDuration}ms`);
  } catch (err) {
    log(`[recipes] error: ${err.message}`);
    try {
      await recordFailure(mongo, 'recipes', err);
    } catch (recordErr) {
      log(`[recipes] failed to record failure: ${recordErr.message}`);
    }
    throw err;
  } finally {
    await mongo.close();
    await redis.disconnect();
    log('[recipes] job finished');
  }
}

module.exports = updateRecipes;

if (require.main === module) {
  updateRecipes().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
