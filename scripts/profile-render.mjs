import { performance } from 'node:perf_hooks';
import { hydrateAggregateTree } from '../src/js/utils/aggregateHydrator.js';

function ensureNumber(value, fallback = 0) {
  if (value == null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function createRawTree() {
  return {
    id: 1001,
    name: 'Espada ancestral',
    icon: 'https://cdn.test/ancient-sword.png',
    rarity: 'Legendario',
    count: 1,
    countTotal: 1,
    buy_price: 1500,
    sell_price: 2200,
    total_buy: 1500,
    total_sell: 2200,
    is_craftable: true,
    recipe: {
      id: 9001,
      output_item_count: 1,
      ingredients: [
        { item_id: 2001, count: 2 },
        { item_id: 2002, count: 4 },
      ],
    },
    mode: 'buy',
    modeForParentCrafted: 'buy',
    expanded: true,
    children: [
      {
        id: 2001,
        name: 'Lingote ancestral',
        icon: 'https://cdn.test/ingot.png',
        rarity: 'Exótico',
        count: 2,
        countTotal: 2,
        buy_price: 250,
        sell_price: 300,
        total_buy: 500,
        total_sell: 600,
        is_craftable: false,
        recipe: null,
        mode: 'buy',
        modeForParentCrafted: 'buy',
        expanded: false,
        children: [],
      },
      {
        id: 2002,
        name: 'Esencia templada',
        icon: 'https://cdn.test/essence.png',
        rarity: 'Raro',
        count: 4,
        countTotal: 4,
        buy_price: 125,
        sell_price: 190,
        total_buy: 500,
        total_sell: 760,
        is_craftable: false,
        recipe: null,
        mode: 'buy',
        modeForParentCrafted: 'buy',
        expanded: false,
        children: [],
      },
    ],
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createPrehydratedTree() {
  const base = createRawTree();
  const state = { nextUid: 1 };
  function convert(node, parentUid = null) {
    const uid = state.nextUid++;
    const children = Array.isArray(node.children) ? node.children : [];
    const converted = {
      _uid: uid,
      _parentId: parentUid,
      _parent: null,
      id: node.id ?? null,
      name: node.name ?? null,
      icon: node.icon ?? null,
      rarity: node.rarity ?? null,
      count: ensureNumber(node.count, 1),
      countTotal: ensureNumber(node.countTotal, ensureNumber(node.count, 1)),
      buy_price: ensureNumber(node.buy_price, 0),
      sell_price: ensureNumber(node.sell_price, 0),
      total_buy: ensureNumber(node.total_buy, 0),
      total_sell: ensureNumber(node.total_sell, 0),
      total_crafted: node.total_crafted == null ? null : ensureNumber(node.total_crafted, 0),
      crafted_price: node.crafted_price == null ? null : ensureNumber(node.crafted_price, 0),
      output: node.output == null ? null : ensureNumber(node.output, null),
      is_craftable: Boolean(node.is_craftable),
      recipe: node.recipe ? clone(node.recipe) : null,
      mode: typeof node.mode === 'string' ? node.mode : 'buy',
      modeForParentCrafted:
        typeof node.modeForParentCrafted === 'string' ? node.modeForParentCrafted : 'buy',
      expanded: Boolean(node.expanded),
      warnings: Array.isArray(node.warnings) ? [...node.warnings] : [],
      children: [],
      __hydrated: true,
    };
    converted.children = children.map((child) => convert(child, uid));
    return converted;
  }
  const root = convert(base, null);
  function tagParentRefs(node, parent) {
    node._parent = null;
    node._parentId = parent ? parent._uid : null;
    node.__hydrated = true;
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => tagParentRefs(child, node));
    }
  }
  tagParentRefs(root, null);
  return root;
}

function computeP95(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.floor(sorted.length * 0.95) - 1);
  return sorted[index];
}

async function profile(label, factory, iterations = 200) {
  const durations = [];
  for (let i = 0; i < iterations; i += 1) {
    const sample = factory();
    const start = performance.now();
    hydrateAggregateTree(sample);
    durations.push(performance.now() - start);
  }
  const p95 = computeP95(durations);
  const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  return { label, average, p95 };
}

async function main() {
  const iterations = Number(process.argv[2]) || 250;
  const raw = createRawTree();
  const prehydrated = createPrehydratedTree();
  const results = [];
  results.push(
    await profile('legacy-hydrator', () => clone(raw), iterations),
  );
  results.push(
    await profile('precomputed-hydrator', () => clone(prehydrated), iterations),
  );
  console.table(
    results.map((entry) => ({
      escenario: entry.label,
      promedio_ms: Number(entry.average.toFixed(3)),
      p95_ms: Number(entry.p95.toFixed(3)),
    })),
  );
}

main().catch((err) => {
  console.error('[profile-render] failed', err);
  process.exitCode = 1;
});
