'use strict';

const { parentPort, workerData, isMainThread } = require('worker_threads');
const { MongoClient } = require('mongodb');

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveOutput(node) {
  const direct = safeNumber(node.output);
  if (direct !== null && direct > 0) {
    return direct;
  }
  const recipe = node.recipe || {};
  const recipeOutput = safeNumber(recipe.output_item_count);
  if (recipeOutput !== null && recipeOutput > 0) {
    return recipeOutput;
  }
  return 1;
}

function collectItemIds(node, acc = new Set()) {
  if (!node || typeof node !== 'object') {
    return acc;
  }
  if (node.id !== undefined && node.id !== null && node.type !== 'Currency') {
    const id = Number(node.id);
    if (Number.isFinite(id)) {
      acc.add(id);
    }
  }
  if (Array.isArray(node.components)) {
    for (const component of node.components) {
      collectItemIds(component, acc);
    }
  }
  return acc;
}

function sanitizeItem(doc) {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  const { _id, lastUpdated, ...rest } = doc;
  if (lastUpdated instanceof Date) {
    rest.lastUpdated = lastUpdated.toISOString();
  }
  return rest;
}

function sanitizeRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    return null;
  }
  const {
    id,
    output_item_id,
    output_item_count,
    time_to_craft_ms,
    min_rating,
    disciplines,
    ingredients,
    type,
    flags,
    chat_link,
    guild_ingredients,
    output_item_count_range,
    achievement_id,
    merchant,
    daily_purchase_cap,
    weekly_purchase_cap,
  } = recipe;
  const sanitized = {
    id: safeNumber(id) ?? null,
    output_item_id: safeNumber(output_item_id) ?? null,
    output_item_count: safeNumber(output_item_count) ?? 1,
    time_to_craft_ms: safeNumber(time_to_craft_ms),
    min_rating: safeNumber(min_rating),
    disciplines: Array.isArray(disciplines) ? disciplines : [],
    achievement_id: safeNumber(achievement_id),
    merchant: merchant || null,
    daily_purchase_cap: safeNumber(daily_purchase_cap),
    weekly_purchase_cap: safeNumber(weekly_purchase_cap),
  };
  if (type) sanitized.type = type;
  if (flags) sanitized.flags = flags;
  if (chat_link) sanitized.chat_link = chat_link;
  if (output_item_count_range) sanitized.output_item_count_range = output_item_count_range;
  if (guild_ingredients) sanitized.guild_ingredients = guild_ingredients;
  sanitized.ingredients = Array.isArray(ingredients)
    ? ingredients.map((ing) => ({
        item_id: safeNumber(ing.item_id) ?? null,
        count: safeNumber(ing.count) ?? 0,
        type: ing.type || 'Item',
      }))
    : [];
  return sanitized;
}

function buildAggregateTree(node, context) {
  const {
    itemsById,
    pricesById,
    multiplier,
    warnings,
    warningSet,
    visited,
  } = context;

  const nodeId = Number(node.id);
  const quantity = safeNumber(node.quantity) ?? 1;
  const isRecipe = node.type === 'Recipe';
  const output = resolveOutput(node);

  const nextVisited = isRecipe ? new Set(visited) : visited;
  if (isRecipe) {
    if (nextVisited.has(nodeId)) {
      if (!warningSet.has(`cycle:${nodeId}`)) {
        warningSet.add(`cycle:${nodeId}`);
        warnings.push(`Circular dependency detected for recipe ${nodeId}`);
      }
      return {
        id: nodeId,
        name: itemsById.get(nodeId)?.name || null,
        icon: itemsById.get(nodeId)?.icon || null,
        rarity: itemsById.get(nodeId)?.rarity || null,
        type: node.type,
        count: quantity,
        countTotal: 0,
        output,
        buy_price: null,
        sell_price: null,
        total_buy: 0,
        total_sell: 0,
        total_crafted: null,
        crafted_price: null,
        is_craftable: false,
        recipe: sanitizeRecipe(node.recipe),
        mode: 'buy',
        modeForParentCrafted: 'buy',
        expanded: false,
        children: [],
        warnings: ['cycle'],
      };
    }
    nextVisited.add(nodeId);
  }

  const baseMultiplier = safeNumber(multiplier) ?? 0;
  const baseAmount = baseMultiplier * quantity;
  const craftsNeededRaw = isRecipe && output > 0 ? Math.ceil(baseAmount / output) : 0;
  const craftsNeeded =
    craftsNeededRaw > 0 ? craftsNeededRaw : isRecipe && baseAmount > 0 ? 1 : craftsNeededRaw;
  const countTotal = isRecipe ? craftsNeeded * output : baseAmount;
  const normalizedCountTotal = Number.isFinite(countTotal) ? countTotal : 0;

  const itemInfo = itemsById.get(nodeId);
  if (!itemInfo && node.type !== 'Currency') {
    if (!warningSet.has(`item:${nodeId}`)) {
      warningSet.add(`item:${nodeId}`);
      warnings.push(`Missing item metadata for ${nodeId}`);
    }
  }
  const priceInfo = pricesById.get(nodeId);
  if (!priceInfo && node.type !== 'Currency') {
    if (!warningSet.has(`price:${nodeId}`)) {
      warningSet.add(`price:${nodeId}`);
      warnings.push(`Missing price information for ${nodeId}`);
    }
  }

  const buyPriceEach = priceInfo ? safeNumber(priceInfo.buy_price) : null;
  const sellPriceEach = priceInfo ? safeNumber(priceInfo.sell_price) : null;

  const childMultiplier = isRecipe ? Math.max(0, craftsNeeded) : 0;
  const children = Array.isArray(node.components)
    ? node.components.map((component) =>
        buildAggregateTree(component, {
          itemsById,
          pricesById,
          multiplier: childMultiplier,
          warnings,
          warningSet,
          visited: new Set(nextVisited),
        }),
      )
    : [];

  const totalChildrenBuy = children.reduce((sum, child) => sum + (safeNumber(child.total_buy) || 0), 0);
  const totalChildrenSell = children.reduce((sum, child) => sum + (safeNumber(child.total_sell) || 0), 0);

  const buyPriceTotal = buyPriceEach !== null ? buyPriceEach * normalizedCountTotal : 0;
  const sellPriceTotal = sellPriceEach !== null ? sellPriceEach * normalizedCountTotal : 0;

  const isCraftable = isRecipe && children.length > 0;

  let total_buy = isCraftable ? totalChildrenBuy : buyPriceTotal;
  if (total_buy === 0 && buyPriceEach === null && isCraftable) {
    total_buy = totalChildrenBuy;
  }
  let total_sell = isCraftable ? sellPriceTotal || totalChildrenSell : sellPriceTotal;
  if (!Number.isFinite(total_sell)) {
    total_sell = 0;
  }

  const total_crafted = isCraftable ? totalChildrenBuy : null;
  const crafted_price =
    isCraftable && total_crafted !== null && output > 0 ? total_crafted / output : null;

  const result = {
    id: nodeId,
    name: itemInfo?.name ?? null,
    icon: itemInfo?.icon ?? null,
    rarity: itemInfo?.rarity ?? null,
    type: node.type,
    count: quantity,
    countTotal: normalizedCountTotal,
    output,
    buy_price: buyPriceEach,
    sell_price: sellPriceEach,
    total_buy,
    total_sell,
    total_crafted,
    crafted_price,
    is_craftable: isCraftable,
    recipe: sanitizeRecipe(node.recipe),
    mode: 'buy',
    modeForParentCrafted: 'buy',
    expanded: false,
    children,
  };

  if (itemInfo && itemInfo.lang) {
    result.lang = itemInfo.lang;
  }

  return result;
}

function deriveTotals(tree, priceInfo) {
  const buyUnit = priceInfo ? safeNumber(priceInfo.buy_price) : null;
  const sellUnit = priceInfo ? safeNumber(priceInfo.sell_price) : null;

  if (!tree) {
    return {
      buy: buyUnit ?? 0,
      sell: sellUnit ?? 0,
      crafted: buyUnit ?? 0,
      unitBuyPrice: buyUnit,
      unitSellPrice: sellUnit,
    };
  }

  const countTotal = safeNumber(tree.countTotal) ?? 0;
  const directBuy = buyUnit !== null ? buyUnit * countTotal : null;
  const directSell = sellUnit !== null ? sellUnit * countTotal : null;
  const craftedTotal =
    tree.total_crafted !== null && tree.total_crafted !== undefined
      ? safeNumber(tree.total_crafted)
      : safeNumber(tree.total_buy);

  return {
    buy: directBuy !== null ? directBuy : safeNumber(tree.total_buy) ?? 0,
    sell: directSell !== null ? directSell : safeNumber(tree.total_sell) ?? 0,
    crafted: craftedTotal ?? 0,
    unitBuyPrice: buyUnit,
    unitSellPrice: sellUnit,
  };
}

function checkDeadline(deadline) {
  if (Date.now() > deadline) {
    const err = new Error('Aggregation timeout exceeded');
    err.code = 'AGGREGATION_TIMEOUT';
    throw err;
  }
}

function serializeError(err) {
  if (!err || typeof err !== 'object') {
    return { message: String(err) };
  }
  return {
    message: err.message || 'Unknown worker error',
    code: err.code,
    stack: err.stack,
  };
}

async function runBuild({ itemId, lang, config }) {
  const defaultLang = (config?.defaultLang || 'es').trim() || 'es';
  const normalizedLang = (lang || defaultLang).trim() || defaultLang;
  const normalizedId = Number(itemId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error('Invalid itemId');
  }

  const softTtlSeconds = Number(config?.softTtlSeconds) || 600;
  const maxAggregationMs = Number(config?.maxAggregationMs) || 12000;
  const start = Date.now();
  const deadline = start + maxAggregationMs;

  const mongoUrl = config?.mongo?.url || 'mongodb://localhost:27017/gw2';
  const readPreference = config?.mongo?.readPreference || 'secondaryPreferred';
  const maxPoolSize = config?.mongo?.maxPoolSize || 8;

  const client = new MongoClient(mongoUrl, {
    maxPoolSize,
    readPreference,
  });
  await client.connect();

  try {
    const db = client.db();

    checkDeadline(deadline);
    const itemDoc = await db
      .collection('items')
      .findOne({ id: normalizedId, lang: normalizedLang }, { projection: { _id: 0 } });
    if (!itemDoc) {
      throw new Error(`Item ${normalizedId} not found`);
    }

    checkDeadline(deadline);
    const treeDoc = await db
      .collection('recipeTrees')
      .findOne({ id: normalizedId }, { projection: { _id: 0 } });

    const warnings = [];
    const warningSet = new Set();

    let aggregateTree = null;
    let totals = null;

    if (treeDoc) {
      const itemIds = collectItemIds(treeDoc, new Set());
      itemIds.add(normalizedId);
      const ids = Array.from(itemIds);

      checkDeadline(deadline);
      const itemsCursor = db
        .collection('items')
        .find(
          { id: { $in: ids }, lang: { $in: [normalizedLang, defaultLang] } },
          { projection: { _id: 0 } },
        );
      const itemDocs = await itemsCursor.toArray();
      const itemsById = new Map();
      for (const doc of itemDocs) {
        const existing = itemsById.get(doc.id);
        if (!existing || doc.lang === normalizedLang) {
          itemsById.set(doc.id, sanitizeItem(doc));
        }
      }

      checkDeadline(deadline);
      const pricesCursor = db
        .collection('prices')
        .find({ id: { $in: ids } }, { projection: { _id: 0 } });
      const pricesDocs = await pricesCursor.toArray();
      const pricesById = new Map();
      for (const doc of pricesDocs) {
        pricesById.set(doc.id, doc);
      }

      aggregateTree = buildAggregateTree(treeDoc, {
        itemsById,
        pricesById,
        multiplier: 1,
        warnings,
        warningSet,
        visited: new Set(),
      });
      totals = deriveTotals(aggregateTree, pricesById.get(normalizedId));
    } else {
      checkDeadline(deadline);
      const priceDoc = await db
        .collection('prices')
        .findOne({ id: normalizedId }, { projection: { _id: 0 } });
      totals = deriveTotals(null, priceDoc);
      warnings.push('Recipe tree not available; using price data only');
    }

    const now = new Date();
    const snapshotAt = now.toISOString();
    const meta = {
      itemId: normalizedId,
      lang: normalizedLang,
      snapshotAt,
      generatedAt: snapshotAt,
      durationMs: Date.now() - start,
      expiresAt: new Date(now.getTime() + softTtlSeconds * 1000).toISOString(),
      stale: false,
      warnings,
      errors: [],
    };
    const payload = {
      data: {
        item: sanitizeItem(itemDoc),
        tree: aggregateTree,
        totals,
      },
      meta,
    };

    return payload;
  } finally {
    try {
      await client.close();
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[aggregate] failed to close mongo client: ${err.message}`);
      }
    }
  }
}

module.exports = {
  runBuild,
};

if (!isMainThread) {
  runBuild(workerData)
    .then((payload) => {
      if (parentPort) {
        parentPort.postMessage({ ok: true, payload });
      }
    })
    .catch((err) => {
      if (parentPort) {
        parentPort.postMessage({ ok: false, error: serializeError(err) });
      }
    });
}
