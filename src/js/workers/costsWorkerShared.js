import { CraftIngredient } from '../items-core.js';

export function rebuildTreeArray(tree) {
  if (!Array.isArray(tree)) return [];
  return tree.map((node) => rebuildNode(node, null));
}

function rebuildNode(data, parent) {
  const ingredient = new CraftIngredient(data);
  Object.assign(ingredient, data);

  if (typeof data._uid === 'number') {
    ingredient._uid = data._uid;
    if (CraftIngredient.nextUid <= data._uid) {
      CraftIngredient.nextUid = data._uid + 1;
    }
  }

  ingredient._parent = parent || null;
  ingredient.children = Array.isArray(data.children)
    ? data.children.map((child) => rebuildNode(child, ingredient))
    : [];

  return ingredient;
}

export function recalcAll(ingredientObjs, globalQty) {
  if (!ingredientObjs) return;
  ingredientObjs.forEach((ingredient) => {
    ingredient.recalc(globalQty, null);
  });
}

export function getTotals(ingredientObjs) {
  let totalBuy = 0;
  let totalSell = 0;
  let totalCrafted = 0;

  for (const ingredient of ingredientObjs || []) {
    totalBuy += ingredient.total_buy || 0;
    totalSell += ingredient.total_sell || 0;

    switch (ingredient.modeForParentCrafted) {
      case 'sell':
        totalCrafted += ingredient.total_sell || 0;
        break;
      case 'crafted':
        totalCrafted += ingredient.total_crafted || 0;
        break;
      default:
        totalCrafted += ingredient.total_buy || 0;
        break;
    }
  }

  return { totalBuy, totalSell, totalCrafted };
}

export function runCostsComputation({ ingredientTree = [], globalQty = 1 } = {}) {
  const ingredientObjs = rebuildTreeArray(ingredientTree);
  recalcAll(ingredientObjs, globalQty);
  const totals = getTotals(ingredientObjs);
  return { updatedTree: ingredientObjs, totals };
}
