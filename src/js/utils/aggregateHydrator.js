import { CraftIngredient } from '../items-core.js';

function ensureNumber(value, fallback = 0) {
  if (value == null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function hydrateAggregateTree(tree) {
  if (!tree) return null;
  return hydrateNode(tree, null);
}

function hydrateNode(node, parent) {
  const ingredient = new CraftIngredient({
    id: node.id,
    name: node.name,
    icon: node.icon,
    rarity: node.rarity,
    count: ensureNumber(node.count, 1),
    buy_price: ensureNumber(node.buy_price, 0),
    sell_price: ensureNumber(node.sell_price, 0),
    is_craftable: Boolean(node.is_craftable),
    recipe: node.recipe || null,
    children: [],
    _parentId: parent ? parent._uid : null,
  });
  ingredient.countTotal = ensureNumber(node.countTotal, ingredient.count);
  ingredient.total_buy = ensureNumber(node.total_buy, ingredient.buy_price * ingredient.countTotal);
  ingredient.total_sell = ensureNumber(node.total_sell, ingredient.sell_price * ingredient.countTotal);
  ingredient.total_crafted = node.total_crafted == null ? null : ensureNumber(node.total_crafted, 0);
  ingredient.crafted_price = node.crafted_price == null ? null : ensureNumber(node.crafted_price, 0);
  ingredient.mode = node.mode || 'buy';
  ingredient.modeForParentCrafted = node.modeForParentCrafted || 'buy';
  ingredient.expanded = Boolean(node.expanded);
  ingredient._parent = parent || null;
  const children = Array.isArray(node.children) ? node.children : [];
  ingredient.children = children.map((child) => hydrateNode(child, ingredient));
  return ingredient;
}
