var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

// src/calculateTreeQuantity.ts
function calculateTreeQuantity(amount, tree, availableItems = {}) {
  return calculateTreeQuantityInner(amount, tree, __spreadValues({}, availableItems));
}
function calculateTreeQuantityInner(amount, tree, availableItems, ignoreAvailable = false, nesting = 0) {
  const output = tree.output || 1;
  let treeQuantity = amount * tree.quantity;
  treeQuantity = Math.ceil(treeQuantity / output) * output;
  const totalQuantity = Math.round(treeQuantity);
  let availableQuantity = 0;
  if (nesting > 0 && tree.type !== "Currency" && !ignoreAvailable && availableItems[tree.id]) {
    availableQuantity = Math.min(availableItems[tree.id], totalQuantity);
    availableItems[tree.id] -= availableQuantity;
  }
  const usedQuantity = totalQuantity - availableQuantity;
  if (!tree.components) {
    return __spreadProps(__spreadValues({}, tree), { components: void 0, output, totalQuantity, usedQuantity });
  }
  const componentAmount = Math.ceil(usedQuantity / output);
  ignoreAvailable = "craft" in tree && tree.craft === false || usedQuantity === 0 || ignoreAvailable;
  const components = tree.components.map((component) => {
    return calculateTreeQuantityInner(
      componentAmount,
      component,
      availableItems,
      ignoreAvailable,
      ++nesting
    );
  });
  return __spreadProps(__spreadValues({}, tree), { components, output, totalQuantity, usedQuantity });
}

// src/static/currencyDecisionPrices.ts
var CURRENCY_DECISION_PRICES = {
  1: 1,
  // Gold
  2: 1,
  // Karma
  3: 3500,
  // Laurel
  4: 3e3,
  // Gem
  5: 32,
  // Ascalonian Tear
  6: 32,
  // Shard of Zhaitan
  7: 80,
  // Fractal Relic
  9: 32,
  // Seal of Beetletun
  10: 32,
  // Manifesto of the Moletariate
  11: 32,
  // Deadly Bloom
  12: 32,
  // Symbol of Koda
  13: 32,
  // Flame Legion Charr Carving
  14: 32,
  // Knowledge Crystal
  15: 23,
  // Badge of Honor
  16: 3600,
  // Guild Commendation
  18: void 0,
  // Transmutation Charge
  19: 70,
  // Airship Part
  20: 70,
  // Ley Line Crystal
  22: 70,
  // Lump of Aurillium
  23: 3600,
  // Spirit Shard
  24: 15 * 80,
  // Pristine Fractal Relic
  25: 100,
  // Geode
  26: 800,
  // WvW Skirmish Claim Ticket
  27: 45,
  // Bandit Crest
  28: 3600,
  // Magnetite Shard
  29: 3600,
  // Provisioner Token
  30: void 0,
  // PvP League Ticket
  31: 50,
  // Proof of Heroics
  32: 25,
  // Unbound Magic
  33: 1600,
  // Ascended Shards of Glory
  34: 9,
  // Trade Contract
  35: 720,
  // Elegy Mosaic
  36: 135,
  // Testimony of Desert Heroics
  37: void 0,
  // Exalted Key
  38: void 0,
  // Machete
  39: 3600,
  // Gaeting Crystal
  40: void 0,
  // Bandit Skeleton Key
  41: void 0,
  // Pact Crowbar
  42: void 0,
  // Vial of Chak Acid
  43: void 0,
  // Zephyrite Lockpick
  44: void 0,
  // Trader's Key
  45: 50,
  // Volatile Magic
  46: void 0,
  // PvP Tournament Voucher
  47: void 0,
  // Racing Medallion
  49: void 0,
  // Mistborn Key
  50: 25,
  // Festival Token
  51: void 0,
  // Cache Key
  52: void 0,
  // Red Prophet Shard
  53: 3500,
  // Green Prophet Shard
  54: void 0,
  // Blue Prophet Crystal
  55: void 0,
  // Green Prophet Crystal
  56: void 0,
  // Red Prophet Crystal
  57: 300,
  // Blue Prophet Shard
  58: void 0,
  // War Supplies
  59: void 0,
  // Unstable Fractal Essence
  60: 310,
  // Tyrian Defense Seal
  61: 200,
  // Research Note
  62: 100,
  // Unusual Coin
  64: 35,
  // Jade Sliver
  65: 135,
  // Testimony of Jade Heroics
  67: 35,
  // Canach Coins
  68: 320,
  // Imperial Favor
  69: 32,
  // Tales of Dungeon Delving
  70: void 0
  // Legendary Insight
};

// src/calculateTreePrices.ts
function calculateTreePrices(tree, itemPrices) {
  let buyPriceEach = itemPrices[tree.id] || false;
  if (tree.type === "Currency") {
    buyPriceEach = tree.id === 1 ? 1 : false;
  }
  const buyPrice = buyPriceEach ? tree.usedQuantity * buyPriceEach : false;
  let craftResultPrice = buyPrice;
  let decisionPriceEach = buyPriceEach || void 0;
  if (tree.type === "Currency") {
    decisionPriceEach = CURRENCY_DECISION_PRICES[tree.id];
  }
  let decisionPrice = decisionPriceEach ? tree.usedQuantity * decisionPriceEach : false;
  if (!tree.components) {
    return __spreadProps(__spreadValues({}, tree), {
      components: void 0,
      buyPriceEach,
      buyPrice,
      decisionPrice,
      craftResultPrice,
      craftDecisionPrice: decisionPrice
    });
  }
  const components = tree.components.map((component) => calculateTreePrices(component, itemPrices));
  const craftDecisionPrice = components.map((c) => c.decisionPrice || 0).reduce((a, b) => a + b, 0);
  const craftPrice = components.map((c) => c.craftResultPrice || 0).reduce((a, b) => a + b, 0);
  if (!("craft" in tree && tree.craft === false) && ("craft" in tree && tree.craft === true || !decisionPrice || craftDecisionPrice < decisionPrice)) {
    decisionPrice = craftDecisionPrice;
    craftResultPrice = craftPrice;
  }
  craftResultPrice = craftResultPrice || craftPrice;
  decisionPrice = decisionPrice || craftDecisionPrice;
  return __spreadProps(__spreadValues({}, tree), {
    components,
    buyPriceEach,
    buyPrice,
    craftPrice,
    decisionPrice,
    craftResultPrice,
    craftDecisionPrice
  });
}

// src/calculateTreeCraftFlags.ts
function calculateTreeCraftFlags(tree, forceBuyItems) {
  const hasComponents = !!tree.components;
  const isUsed = tree.usedQuantity !== 0;
  const isCheaperToCraft = typeof tree.craftPrice !== "undefined" && (!tree.buyPrice || tree.decisionPrice < tree.buyPrice);
  const isForceBuy = forceBuyItems.indexOf(tree.id) !== -1;
  const craft = hasComponents && isUsed && isCheaperToCraft && !isForceBuy;
  if (!tree.components) {
    return __spreadProps(__spreadValues({}, tree), { components: void 0, craft });
  }
  const components = tree.components.map(
    (component) => calculateTreeCraftFlags(component, forceBuyItems)
  );
  return __spreadProps(__spreadValues({}, tree), { components, craft });
}

// src/cheapestTree.ts
function cheapestTree(amount, tree, itemPrices, availableItems = {}, forceBuyItems = [], valueOwnItems = false, userEfficiencyTiers = {
  "102306": "0",
  "102205": "0",
  "103049": "0"
}) {
  tree = applyEfficiencyTiersToTree(tree, userEfficiencyTiers);
  if (valueOwnItems) {
    const treeWithQuantityWithoutAvailableItems = calculateTreeQuantity(
      amount,
      tree,
      {}
    );
    const treeWithPriceWithoutAvailableItems = calculateTreePrices(
      treeWithQuantityWithoutAvailableItems,
      itemPrices
    );
    const cheaperToBuyItemIds = getCheaperToBuyItemIds(treeWithPriceWithoutAvailableItems);
    tree = disableCraftForItemIds(tree, cheaperToBuyItemIds);
  }
  const treeWithQuantity = calculateTreeQuantity(amount, tree, availableItems);
  const treeWithPrices = calculateTreePrices(treeWithQuantity, itemPrices);
  let treeWithCraftFlags = calculateTreeCraftFlags(treeWithPrices, forceBuyItems);
  treeWithCraftFlags = __spreadProps(__spreadValues({}, treeWithCraftFlags), { craft: true });
  const treeWithQuantityPostFlags = calculateTreeQuantity(
    amount,
    treeWithCraftFlags,
    availableItems
  );
  return calculateTreePrices(treeWithQuantityPostFlags, itemPrices);
}
function getCheaperToBuyItemIds(tree, ids = []) {
  if (typeof tree.craftDecisionPrice === "number" && typeof tree.buyPrice === "number" && tree.buyPrice < tree.craftDecisionPrice * 0.85) {
    if (!ids.includes(tree.id)) {
      ids.push(tree.id);
    }
  }
  if (tree.components && Array.isArray(tree.components)) {
    tree.components.forEach((component) => getCheaperToBuyItemIds(component, ids));
  }
  return ids;
}
function disableCraftForItemIds(tree, ids) {
  if (ids.includes(tree.id)) {
    tree = __spreadProps(__spreadValues({}, tree), { craft: false });
  }
  if ("components" in tree && Array.isArray(tree.components)) {
    tree.components = tree.components.map(
      (component) => disableCraftForItemIds(component, ids)
    );
  }
  return tree;
}
function applyEfficiencyTiersToTree(tree, userEfficiencyTiers) {
  const id = tree.id ? tree.id.toString() : "";
  if (["102306", "102205", "103049"].includes(id) && tree.merchant && tree.merchant.name.includes("Homestead Refinement")) {
    const efficiencyTier = Number(userEfficiencyTiers[id]);
    if (efficiencyTier > 0) {
      const component = __spreadValues({}, tree.components[0]);
      component.quantity = component.quantity / (efficiencyTier * 2);
      if (component.id === 12142) {
        component.quantity = efficiencyTier === 1 ? 1 : 0.5;
      }
      if (component.id === 12135) {
        component.quantity = efficiencyTier === 1 ? 8 : 4;
      }
      let updatedTree = __spreadProps(__spreadValues({}, tree), { output: component.quantity < 1 ? tree.output * 2 : tree.output });
      if (component.id === 19699 && efficiencyTier === 2) {
        updatedTree.output = updatedTree.output / 2;
      }
      component.quantity = component.quantity < 1 ? 1 : component.quantity;
      updatedTree = __spreadProps(__spreadValues({}, updatedTree), { components: [component, ...tree.components.slice(1)] });
      tree = updatedTree;
    }
  }
  if ("components" in tree && Array.isArray(tree.components)) {
    tree = __spreadProps(__spreadValues({}, tree), {
      components: tree.components.map(
        (component) => applyEfficiencyTiersToTree(component, userEfficiencyTiers)
      )
    });
  }
  return tree;
}

// src/craftingSteps.ts
var MYSTIC_CLOVER_ID = 19675;
function craftingSteps(tree) {
  let steps = craftingStepsInner(tree).reverse();
  steps = steps.filter((step) => step.quantity > 0);
  const mysticCloverSteps = steps.filter((step) => step.id === MYSTIC_CLOVER_ID);
  steps = steps.filter((step) => step.id !== MYSTIC_CLOVER_ID);
  steps = [...mysticCloverSteps, ...steps];
  const merchantSteps = steps.filter(isMerchantWithNoDependencies).sort((a, b) => {
    var _a, _b;
    return ((_b = a.merchant) == null ? void 0 : _b.name.localeCompare(((_a = b.merchant) == null ? void 0 : _a.name) || "")) || 0;
  });
  steps = steps.filter((step) => !isMerchantWithNoDependencies(step));
  steps = [...merchantSteps, ...steps];
  return steps.map((step) => __spreadProps(__spreadValues({}, step), {
    // Calculate how many times you actually have to click on "craft"
    // for items with output > 1 (calculate here when all steps are aggregated)
    crafts: Math.ceil(step.quantity / step.output),
    output: void 0
  }));
}
function craftingStepsInner(tree, steps = [], index = 0) {
  const treeComponents = tree.components;
  if (!treeComponents || tree.craft === false || tree.type === "Currency") {
    return steps;
  }
  const hasCraftedComponents = treeComponents.some((component) => component.craft);
  const stepIndex = steps.findIndex((step) => step.id === tree.id);
  if (stepIndex !== -1) {
    steps[stepIndex].quantity += tree.usedQuantity;
    steps[stepIndex].components = steps[stepIndex].components.map((component) => {
      const treeComponent = treeComponents.find((x) => x.id === component.id);
      component.quantity += treeComponent.totalQuantity;
      return component;
    });
    if (hasCraftedComponents) {
      steps[stepIndex].hasCraftedComponents = hasCraftedComponents;
    }
    index = stepIndex;
  }
  if (stepIndex === -1) {
    steps.splice(index, 0, {
      id: tree.id,
      type: tree.type,
      output: tree.output,
      quantity: tree.usedQuantity,
      minRating: tree.min_rating,
      disciplines: tree.disciplines,
      merchant: tree.merchant,
      prerequisites: tree.prerequisites,
      components: treeComponents.map((component) => ({
        id: component.id,
        type: component.type,
        quantity: component.totalQuantity
      })),
      hasCraftedComponents
    });
  }
  treeComponents.map((component) => craftingStepsInner(component, steps, index + 1));
  return steps;
}
function isMerchantWithNoDependencies(step) {
  return step.disciplines.length === 1 && step.disciplines[0] === "Merchant" && !step.hasCraftedComponents;
}

// src/static/dailyCooldowns.ts
var DAILY_COOLDOWNS = [
  { id: 46745, tradable: false, craftInterval: "daily" },
  // Spool of Thick Elonian Cord
  { id: 46740, tradable: false, craftInterval: "daily" },
  // Spool of Silk Weaving Thread
  { id: 46742, tradable: false, craftInterval: "daily" },
  // Lump of Mithrillium
  { id: 46744, tradable: false, craftInterval: "daily" },
  // Glob of Elder Spirit Residue
  { id: 43772, tradable: false, craftInterval: "daily" },
  // Charged Quartz Crystal
  { id: 46738, tradable: true },
  // Deldrimor Steel Ingot
  { id: 80714, tradable: true },
  // Carbonized Mithrillium Ingot
  { id: 46736, tradable: true },
  // Spiritwood Plank
  { id: 80791, tradable: true },
  // Composite Wood Board
  { id: 46739, tradable: true },
  // Elonian Leather Square
  { id: 80723, tradable: true },
  // Blended Leather Sheet
  { id: 46741, tradable: true },
  // Bolt of Damask
  { id: 80775, tradable: true },
  // Square of Vabbian Silk
  { id: 79763, tradable: true },
  // Gossamer Stuffing
  { id: 66913, tradable: true, craftInterval: "daily" },
  // Clay Pot
  { id: 66993, tradable: true, craftInterval: "daily" },
  // Grow Lamp
  { id: 66917, tradable: true, craftInterval: "daily" },
  // Plate of Meaty Plant Food
  { id: 66923, tradable: true, craftInterval: "daily" },
  // Plate of Piquant Plant Food
  { id: 67377, tradable: true, craftInterval: "daily" },
  // Vial of Maize Balm
  { id: 67015, tradable: true, craftInterval: "daily" },
  // Heat Stone
  { id: 91701, tradable: true, craftInterval: "daily" },
  // Cultivated Sesame Seed
  { id: 91715, tradable: true, craftInterval: "daily" },
  // Cultivated Cilantro Leaf
  { id: 91793, tradable: true, craftInterval: "daily" },
  // Cultivated Mint Leaf
  { id: 91796, tradable: true, craftInterval: "daily" },
  // Cultivated Clove
  { id: 91869, tradable: true, craftInterval: "daily" }
  // Cultivated Peppercorn
];

// src/helpers/dailyCooldowns.ts
var dailyCooldownIds = DAILY_COOLDOWNS.filter((x) => x.craftInterval === "daily").map((x) => x.id);
function dailyCooldowns(tree, breakdown = {}) {
  if (!tree.components || tree.craft === false || tree.type === "Currency") {
    return breakdown;
  }
  if (dailyCooldownIds.indexOf(tree.id) !== -1) {
    breakdown[tree.id] = (breakdown[tree.id] || 0) + tree.usedQuantity;
  }
  const dailyCap = tree.daily_purchase_cap ? tree.daily_purchase_cap : 0;
  const weeklyCap = tree.weekly_purchase_cap ? tree.weekly_purchase_cap : 0;
  if (dailyCap + weeklyCap > 0) {
    breakdown[tree.id] = (breakdown[tree.id] || 0) + tree.usedQuantity;
  }
  tree.components.map((component) => dailyCooldowns(component, breakdown));
  return breakdown;
}

// src/helpers/recipeItems.ts
function recipeItems(tree) {
  if (tree.type === "Currency") {
    return [];
  }
  let ids = [tree.id];
  if (!tree.components) {
    return ids;
  }
  tree.components.map((component) => {
    ids = ids.concat(recipeItems(component));
  });
  ids = ids.filter((value, index, self) => self.indexOf(value) === index);
  return ids;
}

// src/helpers/useVendorPrices.ts
function useVendorPrices(priceMap) {
  return priceMap;
}

// src/updateTree.ts
var treeCache = /* @__PURE__ */ new Map();
function cacheKey(nodeId, amount, itemPrices, availableItems) {
  const pricesKey = Object.keys(itemPrices).sort().map((id) => `${id}:${itemPrices[id]}`).join("|");
  const availableKey = Object.keys(availableItems).sort().map((id) => `${id}:${availableItems[id]}`).join("|");
  return `${nodeId}|${amount}|${pricesKey}|${availableKey}`;
}
function updateTree(amount, tree, itemPrices, availableItems = {}) {
  const key = cacheKey(tree.id, amount, itemPrices, availableItems);
  const cachedTree = treeCache.get(key);
  if (cachedTree) {
    return cachedTree;
  }
  const treeWithQuantity = calculateTreeQuantity(amount, tree, availableItems);
  const pricedTree = calculateTreePrices(treeWithQuantity, itemPrices);
  treeCache.set(key, pricedTree);
  return pricedTree;
}

// src/usedItems.ts
function usedItems(tree, breakdown = {
  buy: {},
  available: {},
  currency: {}
}) {
  const available = tree.totalQuantity - tree.usedQuantity;
  if (available > 0) {
    breakdown.available[tree.id] = (breakdown.available[tree.id] || 0) + available;
  }
  if (!tree.components || tree.craft === false) {
    if (tree.usedQuantity > 0) {
      if (tree.type === "Currency") {
        breakdown.currency[tree.id] = (breakdown.currency[tree.id] || 0) + tree.usedQuantity;
      } else {
        breakdown.buy[tree.id] = (breakdown.buy[tree.id] || 0) + tree.usedQuantity;
      }
    }
    return breakdown;
  }
  tree.components.map((component) => usedItems(component, breakdown));
  return breakdown;
}

// src/static/vendorItems.ts
var VENDOR_ITEMS = {};

// src/index.ts
var staticItems = {
  dailyCooldowns: DAILY_COOLDOWNS.map((x) => x.id),
  buyableDailyCooldowns: DAILY_COOLDOWNS.filter((x) => x.tradable).map((x) => x.id),
  vendorItems: VENDOR_ITEMS
};
export {
  cheapestTree,
  craftingSteps,
  dailyCooldowns,
  recipeItems,
  staticItems,
  updateTree,
  useVendorPrices,
  usedItems
};
//# sourceMappingURL=index.mjs.map