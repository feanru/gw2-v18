import assert from 'assert';
import { CraftIngredient } from '../src/js/items-core.js';

const leaf = new CraftIngredient({
  id: 3,
  name: 'Leaf',
  count: 6,
  buy_price: 10,
  sell_price: 0,
  is_craftable: false,
  recipe: null,
  children: []
});

const mid = new CraftIngredient({
  id: 2,
  name: 'Mid',
  count: 2,
  is_craftable: true,
  recipe: { output_item_count: 3 },
  children: [leaf]
});

const root = new CraftIngredient({
  id: 1,
  name: 'Root',
  count: 1,
  is_craftable: true,
  recipe: { output_item_count: 2 },
  children: [mid]
});

root.recalc(1, null);

assert.strictEqual(mid.countTotal, 2);
assert.strictEqual(leaf.countTotal, 12);
assert.strictEqual(leaf.total_buy, 120);
assert.strictEqual(root.total_buy, 120);

// Mystic Clover special case: count 77
const mc77 = new CraftIngredient({
  id: 19675,
  name: 'Mystic Clover',
  count: 77,
  is_craftable: false,
  children: [
    new CraftIngredient({ id: 19976, name: 'Moneda mística', count: 1, buy_price: 2, sell_price: 3, children: [] }),
    new CraftIngredient({ id: 19721, name: 'Pegote de ectoplasma', count: 1, buy_price: 5, sell_price: 7, children: [] }),
    new CraftIngredient({ id: 19925, name: 'Esquirla de obsidiana', count: 1, buy_price: 11, sell_price: 13, children: [] }),
    new CraftIngredient({ id: 20796, name: 'Piedra filosofal', count: 1, buy_price: 17, sell_price: 19, children: [] })
  ]
});

mc77.recalc();
const expected77 = [250, 250, 250, 1500];
mc77.children.forEach((c, i) => assert.strictEqual(c.countTotal, expected77[i]));
const buy77 = expected77[0] * 2 + expected77[1] * 5 + expected77[2] * 11 + expected77[3] * 17;
const sell77 = expected77[0] * 3 + expected77[1] * 7 + expected77[2] * 13 + expected77[3] * 19;
assert.strictEqual(mc77.total_buy, buy77);
assert.strictEqual(mc77.total_sell, sell77);

// Mystic Clover special case: count 38
const mc38 = new CraftIngredient({
  id: 19675,
  name: 'Mystic Clover',
  count: 38,
  is_craftable: false,
  children: [
    new CraftIngredient({ id: 19976, name: 'Moneda mística', count: 1, buy_price: 2, sell_price: 3, children: [] }),
    new CraftIngredient({ id: 19721, name: 'Pegote de ectoplasma', count: 1, buy_price: 5, sell_price: 7, children: [] }),
    new CraftIngredient({ id: 19925, name: 'Esquirla de obsidiana', count: 1, buy_price: 11, sell_price: 13, children: [] }),
    new CraftIngredient({ id: 20796, name: 'Piedra filosofal', count: 1, buy_price: 17, sell_price: 19, children: [] })
  ]
});

mc38.recalc();
const expected38 = [38, 38, 38, 38];
mc38.children.forEach((c, i) => assert.strictEqual(c.countTotal, expected38[i]));
const buy38 = expected38[0] * 2 + expected38[1] * 5 + expected38[2] * 11 + expected38[3] * 17;
const sell38 = expected38[0] * 3 + expected38[1] * 7 + expected38[2] * 13 + expected38[3] * 19;
assert.strictEqual(mc38.total_buy, buy38);
assert.strictEqual(mc38.total_sell, sell38);

console.log('items-core recalc test passed');
