const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const { nestRecipes } = require('recipe-nesting');
const { log } = require('./logger');
const { getLastSync, setLastSync, recordFailure } = require('./syncStatus');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DEFAULT_LANG = (process.env.DEFAULT_LANG || 'es').trim() || 'es';

async function buildRecipeTrees() {
  const mongo = new MongoClient(MONGO_URL);
  const redis = createClient({ url: REDIS_URL });

  await mongo.connect();
  await redis.connect();

  const timestamp = new Date();
  try {
    log('[recipeTrees] job started');
    if (process.env.DRY_RUN) {
      log('[recipeTrees] DRY_RUN active - skipping build');
      await setLastSync(mongo, 'recipeTrees', timestamp);
      return;
    }
    const lastSync = await getLastSync(mongo, 'recipeTrees');
    if (lastSync) log(`[recipeTrees] last sync ${lastSync.toISOString()}`);

    const recipeCollection = mongo.db().collection('recipes');
    const recipesDocs = await recipeCollection.find().toArray();
    const recipes = recipesDocs.map(({ _id, ...rest }) => rest);
    const recipesByOutput = new Map(recipes.map(r => [r.output_item_id, r]));

    const nested = nestRecipes(recipes);

    function attachOriginal(node) {
      node.recipe = recipesByOutput.get(node.id) || null;
      if (node.components) {
        node.components = node.components.map(comp => {
          if (comp.type === 'Recipe') return attachOriginal(comp);
          return comp;
        });
      }
      return node;
    }

    const treesCollection = mongo.db().collection('recipeTrees');
    for (const root of nested) {
      const tree = attachOriginal(JSON.parse(JSON.stringify(root)));
      tree.lang = DEFAULT_LANG;
      tree.lastUpdated = new Date(timestamp);
      await treesCollection.updateOne({ id: tree.id }, { $set: tree }, { upsert: true });
      await redis.hSet('recipeTrees', String(tree.id), JSON.stringify(tree));
    }
    await setLastSync(mongo, 'recipeTrees', timestamp);
    log(`[recipeTrees] upserted ${nested.length} documents`);
  } catch (err) {
    log(`[recipeTrees] error: ${err.message}`);
    await recordFailure(mongo, 'recipeTrees', err);
    throw err;
  } finally {
    await mongo.close();
    await redis.disconnect();
    log('[recipeTrees] job finished');
  }
}

module.exports = buildRecipeTrees;

if (require.main === module) {
  buildRecipeTrees().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
