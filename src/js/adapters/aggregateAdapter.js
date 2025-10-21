const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

function toNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cloneIfObject(value) {
  return isPlainObject(value) ? { ...value } : null;
}

export function toMeta(metaSource) {
  const meta = cloneIfObject(metaSource) || {};
  meta.stale = typeof metaSource?.stale === 'boolean' ? metaSource.stale : false;
  meta.lang = typeof metaSource?.lang === 'string' ? metaSource.lang : 'es';
  return meta;
}

export function toItem(source) {
  if (!isPlainObject(source)) return null;
  return { ...source };
}

function pickUnitPrice(source) {
  const directBuy = toNumber(source?.unitBuyPrice ?? source?.unit_buy_price);
  const directSell = toNumber(source?.unitSellPrice ?? source?.unit_sell_price);
  const buy =
    directBuy ??
    toNumber(source?.buy_price ?? source?.buyPrice ?? source?.buys?.unit_price);
  const sell =
    directSell ??
    toNumber(source?.sell_price ?? source?.sellPrice ?? source?.sells?.unit_price);
  return { buy, sell };
}

function pickTotals(source) {
  const buy = toNumber(source?.buy ?? source?.totalBuy ?? source?.total_buy);
  const sell = toNumber(source?.sell ?? source?.totalSell ?? source?.total_sell);
  const crafted = toNumber(source?.crafted ?? source?.totalCrafted ?? source?.total_crafted);
  return { buy, sell, crafted };
}

export function toPriceSummary(source) {
  const raw = cloneIfObject(source);
  const unit = pickUnitPrice(source || {});
  const totals = pickTotals(source || {});
  const hasUnit = Number.isFinite(unit.buy) || Number.isFinite(unit.sell);
  const hasTotals =
    Number.isFinite(totals.buy) || Number.isFinite(totals.sell) || Number.isFinite(totals.crafted);
  return {
    unit,
    totals,
    raw,
    hasData: Boolean(hasUnit || hasTotals),
    source: typeof source?.source === 'string' ? source.source : null,
    updatedAt:
      source?.lastChanged ??
      source?.last_changed ??
      source?.lastUpdated ??
      source?.updatedAt ??
      null,
  };
}

export function mergePriceSummaries(preferred, fallback = null) {
  const ensure = (value) => (Number.isFinite(value) ? value : null);
  const preferredUnit = preferred?.unit || {};
  const fallbackUnit = fallback?.unit || {};
  const preferredTotals = preferred?.totals || {};
  const fallbackTotals = fallback?.totals || {};
  const unit = {
    buy: ensure(preferredUnit.buy) ?? ensure(fallbackUnit.buy),
    sell: ensure(preferredUnit.sell) ?? ensure(fallbackUnit.sell),
  };
  const totals = {
    buy: ensure(preferredTotals.buy) ?? ensure(fallbackTotals.buy),
    sell: ensure(preferredTotals.sell) ?? ensure(fallbackTotals.sell),
    crafted: ensure(preferredTotals.crafted) ?? ensure(fallbackTotals.crafted),
  };
  const hasData =
    Number.isFinite(unit.buy) ||
    Number.isFinite(unit.sell) ||
    Number.isFinite(totals.buy) ||
    Number.isFinite(totals.sell) ||
    Number.isFinite(totals.crafted);
  return {
    unit,
    totals,
    raw: preferred?.raw ?? fallback?.raw ?? null,
    hasData,
    source: preferred?.source ?? fallback?.source ?? null,
    updatedAt: preferred?.updatedAt ?? fallback?.updatedAt ?? null,
  };
}

export function toRecipeList(source) {
  if (Array.isArray(source)) {
    return source.filter(isPlainObject).map((entry) => ({ ...entry }));
  }
  if (isPlainObject(source)) {
    return [{ ...source }];
  }
  return [];
}

export function toLegacyPayload(source) {
  if (!isPlainObject(source)) return null;
  return { ...source };
}

export function toUiModel(json) {
  const source = isPlainObject(json) ? json : {};
  const data = isPlainObject(source.data) ? source.data : {};
  const meta = toMeta(source.meta);

  const item = toItem(data.item);

  let market = null;
  if (isPlainObject(data.market)) {
    market = { ...data.market };
  } else if (isPlainObject(data.totals)) {
    market = { ...data.totals };
  }

  const tree = data.tree != null ? data.tree : null;
  const prices = toPriceSummary(market);
  const recipes = toRecipeList(data.recipes ?? data.recipe ?? null);
  const legacy = toLegacyPayload(data.legacy ?? null);

  return {
    item,
    market,
    tree,
    meta,
    prices,
    recipes,
    legacy,
  };
}

export default {
  toUiModel,
  toMeta,
  toItem,
  toPriceSummary,
  mergePriceSummaries,
  toRecipeList,
  toLegacyPayload,
};
