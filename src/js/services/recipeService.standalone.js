import {
  getItemBundles,
  getRecipesForItem,
  getRecipeDetails,
  getItemDetails,
  getItemPrices,
  registerRecipeServiceGlobals
} from './recipeService.js';

const target = typeof window !== 'undefined' ? window : undefined;
registerRecipeServiceGlobals(target);

export {
  getItemBundles,
  getRecipesForItem,
  getRecipeDetails,
  getItemDetails,
  getItemPrices,
  registerRecipeServiceGlobals
};
