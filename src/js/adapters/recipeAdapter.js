import { toMeta, toRecipeList } from './aggregateAdapter.js';

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export function toUiModel(payload) {
  const source = isPlainObject(payload) ? payload : {};
  const meta = toMeta(source.meta);
  const data = isPlainObject(source.data) ? source.data : source;
  const recipes = toRecipeList(data.recipes ?? data.recipe ?? data);
  return {
    recipes,
    primary: recipes.length > 0 ? recipes[0] : null,
    meta,
  };
}

export default { toUiModel };
