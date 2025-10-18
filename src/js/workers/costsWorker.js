import { runCostsComputation, rebuildTreeArray, recalcAll, getTotals } from './costsWorkerShared.js';

const ctx = typeof self !== 'undefined' ? self : globalThis;

ctx.onmessage = (event) => {
  const { ingredientTree, globalQty } = event.data || {};
  const result = runCostsComputation({ ingredientTree, globalQty });
  ctx.postMessage(result);
};

export { rebuildTreeArray, recalcAll, getTotals };
