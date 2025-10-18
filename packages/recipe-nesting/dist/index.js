"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  nestRecipes: () => nestRecipes
});
module.exports = __toCommonJS(src_exports);
function compact(arr) {
  return arr.filter(Boolean);
}
var nestedRecipeCache = /* @__PURE__ */ new Map();
function nestRecipes(apiRecipes, decorationMap = {}) {
  const recipes = apiRecipes.map(transformRecipe);
  const recipesMap = /* @__PURE__ */ new Map();
  const recipeUpgradesMap = /* @__PURE__ */ new Map();
  recipes.forEach((r) => {
    recipesMap.set(r.id, r);
    if (r.upgrade_id !== void 0) {
      recipeUpgradesMap.set(r.upgrade_id, r.id);
    }
  });
  const decorationsMap = /* @__PURE__ */ new Map();
  Object.entries(decorationMap).forEach(([k, v]) => {
    decorationsMap.set(Number(k), v);
  });
  for (const [key, recipe] of recipesMap) {
    recipesMap.set(
      key,
      nestRecipe(recipe, recipesMap, recipeUpgradesMap, decorationsMap, /* @__PURE__ */ new Set())
    );
  }
  return compact(Array.from(recipesMap.values())).filter((recipe) => recipe.components);
}
function transformRecipe(recipe) {
  const components = recipe.ingredients.map((ingredient) => ({
    id: ingredient.id,
    type: ingredient.type,
    quantity: ingredient.count
  }));
  return {
    id: recipe.output_item_id,
    type: "Recipe",
    quantity: 1,
    output: recipe.output_item_count,
    components,
    prerequisites: recipe.id ? [{ type: "Recipe", id: recipe.id }] : [],
    min_rating: recipe.min_rating !== void 0 ? recipe.min_rating : null,
    disciplines: recipe.disciplines || [],
    upgrade_id: recipe.output_upgrade_id,
    output_range: recipe.output_item_count_range,
    achievement_id: recipe.achievement_id,
    merchant: recipe.merchant,
    multipleRecipeCount: recipe.multipleRecipeCount,
    daily_purchase_cap: recipe.daily_purchase_cap ? recipe.daily_purchase_cap : 0,
    weekly_purchase_cap: recipe.weekly_purchase_cap ? recipe.weekly_purchase_cap : 0
  };
}
function nestRecipe(recipe, recipesMap, recipeUpgradesMap, decorationsMap, visited) {
  const cached = nestedRecipeCache.get(recipe.id);
  if (cached) {
    return cached;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(recipe.id);
  recipe.quantity = recipe.quantity || 1;
  const components = (recipe.components || []).map((component) => {
    const isGuildUpgrade = component.type === "GuildUpgrade";
    const id = isGuildUpgrade ? recipeUpgradesMap.get(component.id) || component.id : component.id;
    const componentRecipe = recipesMap.get(id);
    const condensedLeyLineEssenceIds = [91224, 91137, 91222, 91171];
    if (component.type === "Currency") {
      return component;
    }
    if (!componentRecipe) {
      if (!isGuildUpgrade) {
        return component;
      }
      const decorationsItem = decorationsMap.get(component.id);
      return decorationsItem ? { id: decorationsItem, type: "Item", quantity: component.quantity } : { id: component.id, type: "GuildUpgrade", quantity: component.quantity };
    }
    if (nextVisited.has(id)) {
      const globalConsole = globalThis.console;
      globalConsole == null ? void 0 : globalConsole.warn(`Circular dependency detected: ${recipe.id} -> ${id}`);
      return component;
    }
    if (condensedLeyLineEssenceIds.includes(recipe.id) && condensedLeyLineEssenceIds.includes(id)) {
      return component;
    }
    const nestedComponent = nestRecipe(
      componentRecipe,
      recipesMap,
      recipeUpgradesMap,
      decorationsMap,
      nextVisited
    );
    return __spreadProps(__spreadValues({}, nestedComponent), { quantity: component.quantity });
  });
  recipe.components = compact(components);
  if (recipe.components && recipe.components.length === 0) {
    recipe.components = void 0;
  }
  const result = recipe;
  nestedRecipeCache.set(recipe.id, result);
  return recipe;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  nestRecipes
});
//# sourceMappingURL=index.js.map