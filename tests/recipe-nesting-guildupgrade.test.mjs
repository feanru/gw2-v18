import assert from 'assert'
import { nestRecipes } from '../packages/recipe-nesting/dist/index.js'

const apiRecipes = [
  {
    output_item_id: 1,
    output_item_count: 1,
    ingredients: [{ id: 2000, type: 'GuildUpgrade', count: 2 }],
    min_rating: 0,
    disciplines: [],
    id: 20,
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
const component = nested[0].components[0]
assert.equal(component.type, 'GuildUpgrade')
assert.equal(component.id, 2000)
assert.equal(component.quantity, 2)

console.log('recipe-nesting-guildupgrade test passed')
