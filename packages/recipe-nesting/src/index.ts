import { API_Recipes_Entry_Next } from './api'

function compact<T>(arr: Array<T | false | null | undefined>): Array<T> {
  return arr.filter(Boolean) as Array<T>
}

export type BasicItemComponent = { id: number; type: 'Item'; quantity: number }
export type BasicCurrencyComponent = { id: number; type: 'Currency'; quantity: number }
export type BasicGuildUpgradeComponent = { id: number; type: 'GuildUpgrade'; quantity: number }
export type Prerequisites = Array<{ type: 'Recipe'; id: number }>

export interface NestedRecipe extends TransformedRecipe {
  components: Array<
    NestedRecipe | BasicItemComponent | BasicCurrencyComponent | BasicGuildUpgradeComponent
  >
}

interface TransformedRecipe {
  id: number
  type: 'Recipe'
  quantity: number
  output: number
  min_rating: number | null
  disciplines: Array<string>
  upgrade_id?: number
  output_range?: string
  achievement_id?: number
  merchant?: { name: string; locations: Array<string> }
  prerequisites: Prerequisites
  multipleRecipeCount: number
  daily_purchase_cap?: number
  weekly_purchase_cap?: number
}

interface TransformedRecipeInternal extends TransformedRecipe {
  components?: Array<
    | TransformedRecipeInternal
    | BasicItemComponent
    | BasicCurrencyComponent
    | BasicGuildUpgradeComponent
  >
}

// Cache nested recipes by recipe id so that repeated calls for the same recipe
// can reuse previously computed structures. If the underlying recipe data
// changes, the cache should be cleared by calling `nestedRecipeCache.clear()`.
const nestedRecipeCache = new Map<number, NestedRecipe>()

export function nestRecipes(
  apiRecipes: Array<API_Recipes_Entry_Next>,
  decorationMap: Record<string, number> = {},
): Array<NestedRecipe> {
  const recipes = apiRecipes.map(transformRecipe)

  // Transform arrays into Maps to avoid repeated linear searches
  const recipesMap = new Map<number, TransformedRecipeInternal>()
  const recipeUpgradesMap = new Map<number, number>()

  recipes.forEach((r) => {
    recipesMap.set(r.id, r)
    if (r.upgrade_id !== undefined) {
      recipeUpgradesMap.set(r.upgrade_id, r.id)
    }
  })

  const decorationsMap = new Map<number, number>()
  Object.entries(decorationMap).forEach(([k, v]) => {
    decorationsMap.set(Number(k), v)
  })

  // Nest all recipes
  for (const [key, recipe] of recipesMap) {
    recipesMap.set(
      key,
      nestRecipe(recipe, recipesMap, recipeUpgradesMap, decorationsMap, new Set()),
    )
  }

  return compact(Array.from(recipesMap.values())).filter((recipe) => recipe.components) as Array<NestedRecipe>
}

function transformRecipe(recipe: API_Recipes_Entry_Next): TransformedRecipeInternal {
  const components = recipe.ingredients.map((ingredient) => ({
    id: ingredient.id,
    type: ingredient.type,
    quantity: ingredient.count,
  }))

  return {
    id: recipe.output_item_id,
    type: 'Recipe',
    quantity: 1,
    output: recipe.output_item_count,
    components: components,
    prerequisites: recipe.id ? [{ type: 'Recipe', id: recipe.id }] : [],
    min_rating: recipe.min_rating !== undefined ? recipe.min_rating : null,
    disciplines: recipe.disciplines || [],
    upgrade_id: recipe.output_upgrade_id,
    output_range: recipe.output_item_count_range,
    achievement_id: recipe.achievement_id,
    merchant: recipe.merchant,
    multipleRecipeCount: recipe.multipleRecipeCount,
    daily_purchase_cap: recipe.daily_purchase_cap ? recipe.daily_purchase_cap : 0,
    weekly_purchase_cap: recipe.weekly_purchase_cap ? recipe.weekly_purchase_cap : 0,
  }
}

function nestRecipe(
  recipe: TransformedRecipeInternal,
  recipesMap: Map<number, TransformedRecipeInternal>,
  recipeUpgradesMap: Map<number, number>,
  decorationsMap: Map<number, number>,
  visited: Set<number>,
) {
  const cached = nestedRecipeCache.get(recipe.id)
  if (cached) {
    return cached as unknown as TransformedRecipeInternal
  }

  const nextVisited = new Set(visited)
  nextVisited.add(recipe.id)
  recipe.quantity = recipe.quantity || 1

  const components = (recipe.components || []).map((component) => {
    const isGuildUpgrade = component.type === 'GuildUpgrade'
    const id = isGuildUpgrade ? recipeUpgradesMap.get(component.id) || component.id : component.id
    const componentRecipe = recipesMap.get(id)
    const condensedLeyLineEssenceIds = [91224, 91137, 91222, 91171]

    if (component.type === 'Currency') {
      return component
    }

    if (!componentRecipe) {
      if (!isGuildUpgrade) {
        return component
      }

      const decorationsItem = decorationsMap.get(component.id)
      return decorationsItem
        ? { id: decorationsItem, type: 'Item' as const, quantity: component.quantity }
        : { id: component.id, type: 'GuildUpgrade' as const, quantity: component.quantity }
    }

    if (nextVisited.has(id)) {
      const globalConsole = (globalThis as any).console
      globalConsole?.warn(`Circular dependency detected: ${recipe.id} -> ${id}`)
      return component
    }

    if (condensedLeyLineEssenceIds.includes(recipe.id) && condensedLeyLineEssenceIds.includes(id)) {
      return component
    }

    const nestedComponent = nestRecipe(
      componentRecipe,
      recipesMap,
      recipeUpgradesMap,
      decorationsMap,
      nextVisited,
    )

    return { ...nestedComponent, quantity: component.quantity }
  })

  recipe.components = compact(components)

  if (recipe.components && recipe.components.length === 0) {
    recipe.components = undefined
  }

  const result = recipe as unknown as NestedRecipe
  nestedRecipeCache.set(recipe.id, result)
  return recipe
}

