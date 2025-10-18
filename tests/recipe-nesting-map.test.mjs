import assert from 'assert'
import { nestRecipes } from '../packages/recipe-nesting/dist/index.js'

const apiRecipes = [
  {
    output_item_id: 1,
    output_item_count: 1,
    ingredients: [{ id: 2, type: 'Item', count: 1 }],
    min_rating: 0,
    disciplines: [],
    id: 10,
    output_upgrade_id: 0,
    output_item_count_range: undefined,
    achievement_id: undefined,
    merchant: undefined,
    multipleRecipeCount: 1,
    daily_purchase_cap: 0,
    weekly_purchase_cap: 0,
  },
  {
    output_item_id: 2,
    output_item_count: 1,
    ingredients: [],
    min_rating: 0,
    disciplines: [],
    id: 11,
    output_upgrade_id: 0,
    output_item_count_range: undefined,
    achievement_id: undefined,
    merchant: undefined,
    multipleRecipeCount: 1,
    daily_purchase_cap: 0,
    weekly_purchase_cap: 0,
  },
]

const nested = nestRecipes(apiRecipes)
assert.equal(nested.length, 1)
const recipe = nested[0]
assert.equal(recipe.id, 1)
assert.equal(recipe.components[0].id, 2)

console.log('recipe-nesting-map test passed')
