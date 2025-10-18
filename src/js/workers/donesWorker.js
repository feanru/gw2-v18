const FIXED_PRICE_ITEMS = {
  19676: 10000
};

const defaultGiftNameChecker = (name = '') => {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.startsWith('don de ') || lower.startsWith('don del ') || lower.startsWith('don de la ');
};

const isLegendaryGiftLike = (name) => {
  if (typeof name !== 'string' || !name) return false;
  const lower = name.toLowerCase();
  return defaultGiftNameChecker(name) || lower.includes('tributo') || lower.includes('bendición');
};

let nonMarketItems = new Map();
let preloadedItems = new Map();
let preloadedPrices = new Map();

function syncNonMarketEntries(entries = []) {
  const updated = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const [id, reason] = entry;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) continue;
    updated.set(numericId, reason || 'market');
  }
  nonMarketItems = updated;
}

function shouldSkipMarketCheck(id, name, type) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return true;
  if (nonMarketItems.has(numericId)) return true;
  if (isLegendaryGiftLike(name)) {
    nonMarketItems.set(numericId, 'gift');
    return true;
  }
  const typeLower = typeof type === 'string' ? type.toLowerCase() : '';
  if (typeLower.includes('account')) {
    nonMarketItems.set(numericId, 'account');
    return true;
  }
  return false;
}

function syncPreloadedItems(items = {}) {
  const updated = new Map();
  if (items && typeof items === 'object') {
    Object.entries(items).forEach(([key, value]) => {
      const numericId = Number(key);
      if (!Number.isFinite(numericId) || !value || typeof value !== 'object') return;
      updated.set(numericId, {
        id: numericId,
        name: value.name || null,
        icon: value.icon || null,
        rarity: value.rarity || null,
        type: value.type || null,
      });
    });
  }
  preloadedItems = updated;
}

function syncPreloadedPrices(prices = {}) {
  const updated = new Map();
  if (prices && typeof prices === 'object') {
    Object.entries(prices).forEach(([key, value]) => {
      const numericId = Number(key);
      if (!Number.isFinite(numericId) || !value || typeof value !== 'object') return;
      const buyPrice = value.buy_price != null ? value.buy_price : null;
      const sellPrice = value.sell_price != null ? value.sell_price : null;
      updated.set(numericId, { buy_price: buyPrice, sell_price: sellPrice });
    });
  }
  Object.entries(FIXED_PRICE_ITEMS).forEach(([key, price]) => {
    const numericId = Number(key);
    if (!Number.isFinite(numericId)) return;
    updated.set(numericId, { buy_price: price, sell_price: price });
  });
  preloadedPrices = updated;
}

function getItemData(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  return preloadedItems.get(numericId) || null;
}

function getPriceData(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  if (Object.prototype.hasOwnProperty.call(FIXED_PRICE_ITEMS, numericId)) {
    const fixed = FIXED_PRICE_ITEMS[numericId];
    return { buy_price: fixed, sell_price: fixed };
  }
  return preloadedPrices.get(numericId) || null;
}

async function adaptNode(node, parentId = null) {
  const info = getItemData(node.id);
  const resolvedName = info?.name || node.name;
  const resolvedType = info?.type || node.type;
  const skipMarket = shouldSkipMarketCheck(node.id, resolvedName, resolvedType);
  const price = skipMarket ? null : getPriceData(node.id);
  const children = Array.isArray(node.components)
    ? await Promise.all(node.components.map(c => adaptNode(c, node.id)))
    : [];
  return {
    id: node.id,
    name: resolvedName,
    icon: info?.icon || null,
    rarity: info?.rarity || null,
    type: resolvedType || null,
    count: node.count,
    buy_price: price?.buy_price ?? null,
    sell_price: price?.sell_price ?? null,
    is_craftable: children.length > 0,
    children,
    _parentId: parentId
  };
}

const ctx = typeof self !== 'undefined' ? self : globalThis;

ctx.onmessage = async (e) => {
  const { rootIngredients = [], skipEntries, preloadedItems: itemsPayload, preloadedPrices: pricesPayload } = e.data || {};
  if (Array.isArray(skipEntries)) {
    syncNonMarketEntries(skipEntries);
  }
  if (itemsPayload) {
    syncPreloadedItems(itemsPayload);
  }
  if (pricesPayload) {
    syncPreloadedPrices(pricesPayload);
  }
  const ingredientTree = await Promise.all(rootIngredients.map(r => adaptNode(r, null)));
  ctx.postMessage({ ingredientTree });
};

export { adaptNode };
