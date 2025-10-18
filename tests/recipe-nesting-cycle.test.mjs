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
    ingredients: [{ id: 3, type: 'Item', count: 1 }],
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
  {
    output_item_id: 3,
    output_item_count: 1,
    ingredients: [{ id: 1, type: 'Item', count: 1 }],
    min_rating: 0,
    disciplines: [],
    id: 12,
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
const r1 = nested.find((r) => r.id === 1)
const r2 = nested.find((r) => r.id === 2)
const r3 = nested.find((r) => r.id === 3)
assert(r1 && r2 && r3)
assert.equal(r1.components[0].id, 2)
assert.equal(r2.components[0].id, 3)
const inner = r2.components[0].components[0]
assert.equal(inner.type, 'Item')
assert.equal(inner.id, 1)

console.log('recipe-nesting-cycle test passed')
