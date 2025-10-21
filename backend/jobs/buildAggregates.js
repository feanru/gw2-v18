'use strict';

const { MongoClient } = require('mongodb');
const snapshotCache = require('../utils/snapshotCache');
const { log } = require('./logger');
const {
  buildItemAggregate,
  DEFAULT_LANG,
  FALLBACK_LANGS,
  SOFT_TTL_SECONDS,
  HARD_TTL_SECONDS,
} = require('../aggregates/buildItemAggregate');
const { savePrecomputedAggregate } = require('../utils/precomputedAggregates');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const BATCH_SIZE = Math.max(1, Number(process.env.PRECOMPUTED_AGGREGATE_BATCH_SIZE || 25));
const MAX_ITEMS = normalizePositiveInt(process.env.PRECOMPUTED_AGGREGATE_MAX_ITEMS, 0);
const EXPLICIT_IDS = parseExplicitIds(process.env.PRECOMPUTED_AGGREGATE_IDS);

function normalizePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function parseExplicitIds(raw) {
  if (!raw) {
    return new Set();
  }
  const list = String(raw)
    .split(',')
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  return new Set(list);
}

async function fetchTargetItemIds(mongo) {
  const explicit = new Set(EXPLICIT_IDS);
  const collection = mongo.db().collection('recipeTrees');
  const ids = await collection.distinct('id');
  for (const id of ids) {
    const numeric = Number(id);
    if (Number.isFinite(numeric) && numeric > 0) {
      explicit.add(numeric);
    }
  }
  const sorted = Array.from(explicit);
  sorted.sort((a, b) => a - b);
  if (MAX_ITEMS && sorted.length > MAX_ITEMS) {
    return sorted.slice(0, MAX_ITEMS);
  }
  return sorted;
}

function ensureNumber(value, fallback = 0) {
  if (value == null) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function cloneRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    return null;
  }
  return JSON.parse(JSON.stringify(recipe));
}

function cloneNode(node, parentUid, state) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const currentUid = state.nextUid++;
  const children = Array.isArray(node.children) ? node.children : [];
  const cloned = {
    _uid: currentUid,
    _parentId: parentUid,
    _parent: null,
    id: node.id ?? null,
    name: node.name ?? null,
    icon: node.icon ?? null,
    rarity: node.rarity ?? null,
    type: node.type ?? null,
    count: ensureNumber(node.count, 1),
    countTotal: ensureNumber(node.countTotal, ensureNumber(node.count, 1)),
    buy_price: ensureNumber(node.buy_price, 0),
    sell_price: ensureNumber(node.sell_price, 0),
    total_buy: ensureNumber(node.total_buy, 0),
    total_sell: ensureNumber(node.total_sell, 0),
    total_crafted: node.total_crafted == null ? null : ensureNumber(node.total_crafted, 0),
    crafted_price: node.crafted_price == null ? null : ensureNumber(node.crafted_price, 0),
    output: node.output == null ? null : ensureNumber(node.output, null),
    is_craftable: Boolean(node.is_craftable),
    recipe: cloneRecipe(node.recipe),
    mode: typeof node.mode === 'string' ? node.mode : 'buy',
    modeForParentCrafted:
      typeof node.modeForParentCrafted === 'string' ? node.modeForParentCrafted : 'buy',
    expanded: Boolean(node.expanded),
    warnings: Array.isArray(node.warnings) ? [...node.warnings] : [],
    children: [],
    __hydrated: true,
  };
  cloned.children = children
    .map((child) => cloneNode(child, currentUid, state))
    .filter(Boolean);
  return cloned;
}

function hydrateTree(tree) {
  if (!tree || typeof tree !== 'object') {
    return null;
  }
  const state = { nextUid: 1 };
  const root = cloneNode(tree, null, state);
  propagateParentRefs(root, null);
  return root;
}

function propagateParentRefs(node, parent) {
  if (!node || typeof node !== 'object') {
    return;
  }
  node._parent = null;
  node._parentId = parent ? parent._uid : null;
  node.__hydrated = true;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      propagateParentRefs(child, node);
    }
  }
}

function buildPrecomputedPayload(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }
  const baseData = result.data && typeof result.data === 'object' ? result.data : {};
  const metaSource = result.meta && typeof result.meta === 'object' ? result.meta : {};
  const tree = hydrateTree(baseData.tree);
  const data = {
    ...baseData,
    tree,
  };
  const meta = {
    ...metaSource,
    precomputed: true,
  };
  if (!meta.source) {
    meta.source = 'precomputed';
  }
  meta.stale = false;
  return { data, meta };
}

async function processSnapshot(mongo, itemId, lang) {
  try {
    const raw = await buildItemAggregate(itemId, lang, { forceRebuild: true });
    if (!raw || !raw.data) {
      log(`[precomputed] skipping ${itemId}/${lang}: empty payload`);
      return false;
    }
    const payload = buildPrecomputedPayload(raw);
    if (!payload) {
      log(`[precomputed] failed to build payload for ${itemId}/${lang}`);
      return false;
    }
    await savePrecomputedAggregate({
      client: mongo,
      itemId,
      lang,
      payload,
      softTtlSeconds: SOFT_TTL_SECONDS,
      hardTtlSeconds: HARD_TTL_SECONDS,
    });
    await snapshotCache.set(`agg:${lang}:${itemId}`, payload, {
      softTtlSeconds: SOFT_TTL_SECONDS,
      hardTtlSeconds: HARD_TTL_SECONDS,
      tags: [`item:${itemId}`, `lang:${lang}`, 'precomputed'],
    });
    return true;
  } catch (err) {
    log(`[precomputed] error for ${itemId}/${lang}: ${err.message}`);
    return false;
  }
}

async function run() {
  const mongo = new MongoClient(MONGO_URL, { ignoreUndefined: true, maxPoolSize: 8 });
  await mongo.connect();
  try {
    const itemIds = await fetchTargetItemIds(mongo);
    if (!itemIds.length) {
      log('[precomputed] no item ids to process');
      return;
    }
    const languages = Array.from(new Set([DEFAULT_LANG, ...FALLBACK_LANGS]));
    let processed = 0;
    let successes = 0;
    log(`[precomputed] starting snapshot build for ${itemIds.length} items x ${languages.length} langs`);
    for (const itemId of itemIds) {
      for (const lang of languages) {
        const ok = await processSnapshot(mongo, itemId, lang);
        processed += 1;
        if (ok) {
          successes += 1;
        }
        if (processed % BATCH_SIZE === 0) {
          log(`[precomputed] progress ${processed} (${successes} ok)`);
        }
      }
    }
    log(`[precomputed] completed ${processed} snapshots (${successes} ok)`);
  } finally {
    await mongo.close();
  }
}

module.exports = run;

if (require.main === module) {
  run().catch((err) => {
    console.error('[precomputed] job failed', err);
    process.exitCode = 1;
  });
}
