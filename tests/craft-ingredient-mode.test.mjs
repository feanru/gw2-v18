import assert from 'assert';
import { CraftIngredient, restoreCraftIngredientPrototypes } from '../src/js/items-core.js';

global.window = { globalQty: 1 };

const child = new CraftIngredient({
  id: 2,
  name: 'Child',
  count: 1,
  buy_price: 5,
  sell_price: 10,
  is_craftable: false,
  recipe: null,
  children: []
});

const root = new CraftIngredient({
  id: 1,
  name: 'Root',
  count: 1,
  is_craftable: true,
  recipe: { output_item_count: 1 },
  children: [child]
});

root.recalc(1, null);

const serialized = JSON.parse(JSON.stringify([root]));
restoreCraftIngredientPrototypes(serialized, null);

const revivedChild = serialized[0].children[0];

assert.doesNotThrow(() => {
  revivedChild.setMode('sell');
  revivedChild.setMode('crafted');
  revivedChild.setMode('buy');
});

console.log('craft ingredient mode toggle test passed');
