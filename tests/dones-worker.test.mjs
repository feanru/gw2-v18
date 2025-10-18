import assert from 'assert';
import { rebuildTreeArray, recalcAll, getTotals } from '../src/js/workers/costsWorker.js';

function manualTotals(tree, globalQty) {
  function traverse(node, parent) {
    const parentCount = parent ? parent.countTotal : globalQty;
    const countTotal = parent ? parentCount * node.count : node.count * globalQty;
    let totalBuy = (node.buy_price || 0) * countTotal;
    let totalSell = (node.sell_price || 0) * countTotal;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        node.countTotal = countTotal;
        const res = traverse(child, node);
        totalBuy += res.totalBuy;
        totalSell += res.totalSell;
      }
    }
    node.countTotal = countTotal;
    node.total_buy = totalBuy;
    node.total_sell = totalSell;
    if (node.is_craftable && node.children && node.children.length > 0) {
      node.total_crafted = node.children.reduce((sum, ing) => {
        switch (ing.modeForParentCrafted) {
          case 'sell': return sum + (ing.total_sell || 0);
          case 'crafted': return sum + (ing.total_crafted || 0);
          default: return sum + (ing.total_buy || 0);
        }
      }, 0);
    } else {
      node.total_crafted = null;
    }
    return { totalBuy, totalSell, totalCrafted: node.total_crafted }; 
  }
  const totals = { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
  for (const ing of tree) {
    const res = traverse(ing, null);
    totals.totalBuy += res.totalBuy;
    totals.totalSell += res.totalSell;
    switch (ing.modeForParentCrafted) {
      case 'sell':
        totals.totalCrafted += ing.total_sell || 0;
        break;
      case 'crafted':
        totals.totalCrafted += ing.total_crafted || 0;
        break;
      default:
        totals.totalCrafted += ing.total_buy || 0;
        break;
    }
  }
  return totals;
}

const sample = [
  {
    id: 1,
    name: 'Root',
    count: 1,
    is_craftable: true,
    recipe: { output_item_count: 2 },
    children: [
      {
        id: 2,
        name: 'Mid',
        count: 2,
        is_craftable: true,
        recipe: { output_item_count: 3 },
        children: [
          { id: 3, name: 'Leaf', count: 6, buy_price: 10, sell_price: 0, is_craftable: false, children: [] }
        ]
      }
    ]
  }
];

const manual = manualTotals(JSON.parse(JSON.stringify(sample)), 1);
const objs = rebuildTreeArray(JSON.parse(JSON.stringify(sample)));
recalcAll(objs, 1);
const totals = getTotals(objs);

assert.deepStrictEqual(totals, manual);
assert.strictEqual(objs[0].children[0].children[0].countTotal, 12);

console.log('dones-worker recalc test passed');
