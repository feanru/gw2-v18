const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { log } = require('./logger');
const { getLastSync, setLastSync, recordFailure } = require('./syncStatus');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const API_URL = 'https://api.guildwars2.com/v2/items';
const DATAWARS_FEED_URL = process.env.DATAWARS_ITEMS_URL || 'https://api.datawars2.ie/gw2/v1/items/json';
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 500;
const RECOVERY_CHUNK_SIZE = Number(process.env.ITEM_RECOVERY_CHUNK_SIZE) || 200;
const DEFAULT_LANG = (process.env.DEFAULT_LANG || 'es').trim() || 'es';
const FALLBACK_LANGS = Array.from(new Set(
  String(process.env.FALLBACK_LANGS ?? 'en')
    .split(',')
    .map((lang) => lang.trim().toLowerCase())
    .filter((lang) => lang && lang !== DEFAULT_LANG),
));

function getRedisKeyForLang(lang) {
  return lang === DEFAULT_LANG ? 'items' : `items:${lang}`;
}

async function fetchItems(lang) {
  const idsParam = process.env.ITEM_IDS || 'all';
  const url = new URL(API_URL);
  url.searchParams.set('ids', idsParam);
  if (lang) {
    url.searchParams.set('lang', lang);
  }
  const res = await fetch(url.href);
  if (!res.ok) {
    throw new Error(`Failed to fetch items: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response format when fetching items');
  }
  return data;
}

async function fetchItemsByIds(ids, lang) {
  if (!ids.length) return [];
  const url = new URL(API_URL);
  url.searchParams.set('ids', ids.join(','));
  if (lang) {
    url.searchParams.set('lang', lang);
  }
  const res = await fetch(url.href);
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch specific items: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response format when fetching specific items');
  }
  return data;
}

async function fetchExpectedItemIds() {
  const res = await fetch(DATAWARS_FEED_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch expected item IDs: ${res.status}`);
  }
  const data = await res.json();
  const ids = new Set();
  let discarded = 0;
  const sourceArray = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
      ? data.items
      : [];
  for (const entry of sourceArray) {
    const numericId = Number(typeof entry === 'number' ? entry : entry?.id ?? entry);
    if (Number.isFinite(numericId)) {
      ids.add(numericId);
    } else {
      discarded += 1;
    }
  }
  if (discarded) {
    log(`[items] discarded ${discarded} ids from DataWars feed due to invalid numeric conversion`);
  }
  return ids;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function updateItems() {
  const mongo = new MongoClient(MONGO_URL);
  const redis = createClient({ url: REDIS_URL });

  await mongo.connect();
  await redis.connect();

  try {
    log('[items] job started');
    if (process.env.DRY_RUN) {
      log('[items] DRY_RUN active - skipping fetch');
      await setLastSync(mongo, 'items');
      return;
    }
    const lastSync = await getLastSync(mongo, 'items');
    if (lastSync) log(`[items] last sync ${lastSync.toISOString()}`);
    const items = await fetchItems(DEFAULT_LANG);
    const spanishIds = new Set();
    const collection = mongo.db().collection('items');
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
      log(`[items] processed ${ops.length} operations in ${duration}ms`);
      ops.length = 0;
      pipeline = redis.multi();
    }

    for (const item of items) {
      if (!item || typeof item.id === 'undefined') {
        continue;
      }
      const document = {
        ...item,
        lang: DEFAULT_LANG,
        source: 'external',
        lastUpdated: new Date(timestamp),
      };
      spanishIds.add(item.id);
      ops.push({
        updateOne: {
          filter: { id: item.id, lang: DEFAULT_LANG },
          update: { $set: document },
          upsert: true,
        },
      });
      pipeline.hSet(getRedisKeyForLang(DEFAULT_LANG), String(item.id), JSON.stringify(document));
      if (ops.length >= BATCH_SIZE) await flush();
    }
    await flush();

    if (FALLBACK_LANGS.length) {
      for (const fallbackLang of FALLBACK_LANGS) {
        const fallbackItems = await fetchItems(fallbackLang);
        for (const item of fallbackItems) {
          if (!item || typeof item.id === 'undefined') {
            continue;
          }
          if (spanishIds.has(item.id)) {
            continue;
          }
          const document = {
            ...item,
            lang: fallbackLang,
            source: 'external',
            lastUpdated: new Date(timestamp),
          };
          ops.push({
            updateOne: {
              filter: { id: item.id, lang: fallbackLang },
              update: { $set: document },
              upsert: true,
            },
          });
          pipeline.hSet(getRedisKeyForLang(fallbackLang), String(item.id), JSON.stringify(document));
          if (ops.length >= BATCH_SIZE) await flush();
        }
      }
      await flush();
    }

    const expectedIds = await fetchExpectedItemIds().catch((err) => {
      log(`[items] failed to fetch DataWars feed: ${err.message}`);
      return null;
    });

    if (expectedIds && expectedIds.size) {
      const languagesToSync = [DEFAULT_LANG, ...FALLBACK_LANGS];
      const knownIds = new Set(spanishIds);
      const existingIds = await collection.distinct('id', { lang: { $in: languagesToSync } });
      for (const id of existingIds) {
        const numericId = typeof id === 'number' ? id : Number(id);
        if (Number.isFinite(numericId)) {
          knownIds.add(numericId);
        }
      }
      const missingIds = Array.from(expectedIds)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && !knownIds.has(id));
      if (missingIds.length) {
        log(`[items] detected ${missingIds.length} ids missing from Mongo/Redis; attempting targeted recovery`);
        const missingSet = new Set(missingIds);
        for (const chunk of chunkArray(missingIds, RECOVERY_CHUNK_SIZE)) {
          log(`[items] recovering ${chunk.length} ids via targeted fetch (sample: ${chunk.slice(0, 5).join(', ')})`);
          for (const lang of languagesToSync) {
            try {
              const recoveredItems = await fetchItemsByIds(chunk, lang);
              for (const item of recoveredItems) {
                if (!item || typeof item.id === 'undefined') {
                  continue;
                }
                const numericId = Number(item.id);
                if (Number.isFinite(numericId)) {
                  missingSet.delete(numericId);
                }
                const document = {
                  ...item,
                  lang: lang,
                  source: 'external',
                  lastUpdated: new Date(timestamp),
                };
                ops.push({
                  updateOne: {
                    filter: { id: item.id, lang },
                    update: { $set: document },
                    upsert: true,
                  },
                });
                pipeline.hSet(getRedisKeyForLang(lang), String(item.id), JSON.stringify(document));
                if (ops.length >= BATCH_SIZE) await flush();
              }
            } catch (err) {
              log(`[items] failed targeted recovery for lang ${lang} chunk starting ${chunk[0]}: ${err.message}`);
            }
          }
          const unresolved = chunk.filter((id) => missingSet.has(id));
          if (unresolved.length) {
            log(`[items] warning: ${unresolved.length} ids still missing after targeted fetch for chunk (sample: ${unresolved.slice(0, 5).join(', ')})`);
          }
        }
        await flush();
        if (missingSet.size) {
          log(`[items] alert: ${missingSet.size} ids remain missing after targeted recovery (sample: ${Array.from(missingSet).slice(0, 10).join(', ')})`);
        } else {
          log('[items] targeted recovery completed successfully for all missing ids');
        }
      }
    }

    await setLastSync(mongo, 'items', timestamp);
    const totalDuration = Date.now() - start;
    log(`[items] upserted ${processed} documents in ${totalDuration}ms`);
  } catch (err) {
    log(`[items] error: ${err.message}`);
    try {
      await recordFailure(mongo, 'items', err);
    } catch (recordErr) {
      log(`[items] failed to record failure: ${recordErr.message}`);
    }
    throw err;
  } finally {
    await mongo.close();
    await redis.disconnect();
    log('[items] job finished');
  }
}

module.exports = updateItems;

if (require.main === module) {
  updateItems().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
