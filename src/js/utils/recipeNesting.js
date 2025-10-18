// Utility functions and recipe nesting logic adapted from referencia-recipe-nesting-master

// Remove falsy values from an array
export function compact(array) {
  return array.filter(Boolean);
}

// Return a new object without the specified keys
export function omit(object, keys) {
  const result = {};
  for (const key in object) {
    if (!keys.includes(key)) {
      result[key] = object[key];
    }
  }
  return result;
}

// Create a lookup map out of an array of objects
export function toMap(array, key, target) {
  const map = {};
  array.forEach((element) => {
    if (element[key] === undefined || element[key] === null) return;
    map[element[key]] = target ? element[target] : element;
  });
  return map;
}

// Transform recipe format to the internal representation used for nesting
function transformRecipe(recipe) {
  const components = recipe.ingredients.map((ingredient) => ({
    id: ingredient.id,
    type: ingredient.type,
    quantity: ingredient.count,
  }));

  return {
    id: recipe.output_item_id,
    type: 'Recipe',
    nested: false,
    quantity: 1,
    output: recipe.output_item_count,
    components: components,
    prerequisites: recipe.id ? [{ type: 'Recipe', id: recipe.id }] : [],
    min_rating: recipe.min_rating !== undefined ? recipe.min_rating : null,
    disciplines: recipe.disciplines || [],
    upgrade_id: recipe.output_upgrade_id,
    output_range: recipe.output_item_count_range,
    achievement_id: recipe.achievement_id,
    merchant: recipe.merchant,
    multipleRecipeCount: recipe.multipleRecipeCount,
    daily_purchase_cap: recipe.daily_purchase_cap ? recipe.daily_purchase_cap : 0,
    weekly_purchase_cap: recipe.weekly_purchase_cap ? recipe.weekly_purchase_cap : 0,
  };
}

// Recursively nest a recipe and its components
function nestRecipe(recipe, recipesMap, recipeUpgradesMap, decorationsMap) {
  if (recipe.nested) {
    return recipe;
  }

  recipe.nested = true;
  recipe.quantity = recipe.quantity || 1;

  const components = (recipe.components || []).map((component) => {
    const isGuildUpgrade = component.type === 'GuildUpgrade';
    const id = isGuildUpgrade ? recipeUpgradesMap[component.id] || component.id : component.id;
    const componentRecipe = recipesMap[id];
    const condensedLeyLineEssenceIds = [91224, 91137, 91222, 91171];

    if (component.type === 'Currency') {
      return component;
    }

    if (!componentRecipe) {
      if (!isGuildUpgrade) {
        return component;
      }
      const decorationsItem = decorationsMap[component.id];
      return decorationsItem
        ? { id: decorationsItem, type: 'Item', quantity: component.quantity }
        : false;
    }

    if (recipe.id === id) {
      return isGuildUpgrade
        ? { id, type: 'Item', quantity: component.quantity }
        : component;
    }

    if (condensedLeyLineEssenceIds.includes(recipe.id) && condensedLeyLineEssenceIds.includes(id)) {
      return component;
    }

    if (!componentRecipe.nested) {
      recipesMap[id] = nestRecipe(componentRecipe, recipesMap, recipeUpgradesMap, decorationsMap);
    }

    return { ...omit(componentRecipe, ['nested']), quantity: component.quantity };
  });

  recipe.components = compact(components);

  if (recipe.components && recipe.components.length === 0) {
    recipe.components = undefined;
  }

  return recipe;
}

// Public API to nest recipes
export function nestRecipes(apiRecipes, decorationMap = {}) {
  const recipes = apiRecipes.map(transformRecipe);
  const recipesMap = toMap(recipes, 'id');
  const recipeUpgradesMap = toMap(recipes, 'upgrade_id', 'id');

  for (const key in recipesMap) {
    const recipe = recipesMap[key];
    if (!recipe) continue;
    recipesMap[key] = nestRecipe(recipe, recipesMap, recipeUpgradesMap, decorationMap);
  }

  return compact(Object.values(recipesMap))
    .map((recipe) => omit(recipe, ['nested']))
    .filter((recipe) => recipe.components);
}

