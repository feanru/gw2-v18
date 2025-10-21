import {
  toMeta,
  toItem,
  toPriceSummary,
  toRecipeList,
  toLegacyPayload,
} from './aggregateAdapter.js';

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export function toUiModel(payload) {
  const source = isPlainObject(payload) ? payload : {};
  const meta = toMeta(source.meta);
  const data = isPlainObject(source.data) ? source.data : source;

  const item = toItem(data.item);
  const market = isPlainObject(data.market) ? { ...data.market } : null;
  const prices = toPriceSummary(market);
  const recipes = toRecipeList(data.recipes ?? data.recipe ?? null);
  const nested = data.nested_recipe && typeof data.nested_recipe === 'object' ? { ...data.nested_recipe } : null;
  const legacy = toLegacyPayload(data.legacy ?? null);

  return {
    item,
    market,
    prices,
    recipes,
    primaryRecipe: recipes.length > 0 ? recipes[0] : null,
    nestedRecipe: nested,
    legacy,
    meta,
  };
}

export default { toUiModel };
