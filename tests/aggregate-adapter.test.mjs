import assert from 'assert';
import { toUiModel } from '../src/js/adapters/aggregateAdapter.js';

(function run() {
  const emptyModel = toUiModel(null);
  assert.strictEqual(emptyModel.item, null);
  assert.strictEqual(emptyModel.market, null);
  assert.strictEqual(emptyModel.tree, null);
  assert.deepStrictEqual(emptyModel.meta, { stale: false, lang: 'es' });

  const nullPayload = toUiModel({ data: null, meta: null });
  assert.strictEqual(nullPayload.item, null);
  assert.strictEqual(nullPayload.market, null);
  assert.strictEqual(nullPayload.tree, null);
  assert.deepStrictEqual(nullPayload.meta, { stale: false, lang: 'es' });

  const totalsFallback = toUiModel({
    data: {
      item: { id: 1, name: 'Item 1' },
      totals: { buy: 10, sell: 20, unitBuyPrice: 5 },
    },
    meta: { stale: false },
  });
  assert.deepStrictEqual(totalsFallback.item, { id: 1, name: 'Item 1' });
  assert.deepStrictEqual(totalsFallback.market, { buy: 10, sell: 20, unitBuyPrice: 5 });
  assert.strictEqual(totalsFallback.tree, null);
  assert.deepStrictEqual(totalsFallback.meta, { stale: false, lang: 'es' });

  const marketPreferred = toUiModel({
    data: {
      item: { id: 2, name: 'Item 2' },
      market: { buy: 30, sell: 60, unitSellPrice: 12 },
      totals: { buy: 0 },
      tree: { id: 2 },
    },
  });
  assert.deepStrictEqual(marketPreferred.market, { buy: 30, sell: 60, unitSellPrice: 12 });
  assert.deepStrictEqual(marketPreferred.tree, { id: 2 });

  const treeNullTolerance = toUiModel({ data: { tree: null } });
  assert.strictEqual(treeNullTolerance.tree, null);

  const metaDefaults = toUiModel({});
  assert.strictEqual(metaDefaults.meta.stale, false);
  assert.strictEqual(metaDefaults.meta.lang, 'es');

  const metaOverrides = toUiModel({ meta: { stale: true, lang: 'en', warnings: ['lag'] } });
  assert.deepStrictEqual(metaOverrides.meta, { warnings: ['lag'], stale: true, lang: 'en' });

  console.log('aggregate-adapter.test.mjs passed');
})();
