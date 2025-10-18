import assert from 'assert';

// Minimal DOM stubs
global.window = {};
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => []
};

global.IntersectionObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
};

global.formatGoldColored = (value) => String(value);
global.getTotals = () => ({ totalBuy: 1, totalSell: 1, totalCrafted: 1 });

const { renderRows, renderMainItemRow } = await import('../src/js/item-ui.js');

const ingredient = {
  id: 1,
  _uid: 'uid1',
  icon: 'icon.png',
  name: 'Test',
  countTotal: 0,
  count: 5,
  is_craftable: false,
  children: [],
  buy_price: 1,
  sell_price: 2,
  total_buy: 1,
  total_sell: 2,
  total_crafted: null,
  modeForParentCrafted: null,
  expanded: false,
  rarity: 'common'
};

const html = renderRows([ingredient]);
const matchZero = html.match(/<td>(\d+)<\/td>/);
assert.ok(matchZero, 'Debe renderizar una celda de cantidad');
assert.strictEqual(matchZero[1], '0', 'countTotal=0 debe mostrarse correctamente');

// countTotal undefined should fall back to count
const ingredientFallback = {
  ...ingredient,
  _uid: 'uid1b',
  countTotal: undefined,
  count: 4
};

const htmlFallback = renderRows([ingredientFallback]);
const matchFallback = htmlFallback.match(/<td>(\d+)<\/td>/);
assert.ok(matchFallback, 'Debe renderizar una celda de cantidad para fallback');
assert.strictEqual(matchFallback[1], '4', 'Debe usar count cuando countTotal es undefined');

// Test for renderMainItemRow with countTotal = 0
const mainNode = {
  id: 2,
  _uid: 'uid2',
  icon: 'icon.png',
  name: 'Main',
  countTotal: 0,
  count: 7,
  children: [{}], // triggers getTotals
  buy_price: 0,
  sell_price: 0,
  total_crafted: null,
  expanded: false,
  rarity: 'common'
};

const mainHtml = renderMainItemRow(mainNode);
const matchMain = mainHtml.match(/<td>(\d+)<\/td>/);
assert.ok(matchMain, 'Debe renderizar una celda de cantidad en la fila principal');
assert.strictEqual(matchMain[1], '0', 'countTotal=0 debe mostrarse en la fila principal');

console.log('item-ui renderRows countTotal 0 test passed');
console.log('item-ui renderMainItemRow countTotal 0 test passed');
