import assert from 'assert'

global.window = {}
global.document = {
  getElementById: () => null,
  querySelectorAll: () => []
}

await import('../src/js/bundle-legendary.js')
const { LegendaryCraftingBase } = window.LegendaryUtils
const calc = new LegendaryCraftingBase({})

// Component with direct prices
const directTree = {
  components: [
    { buyPrice: 1, sellPrice: 2, count: 3, components: [] }
  ]
}
assert.deepStrictEqual(calc.calculateComponentsPrice(directTree), { buy: 3, sell: 6 })

// Component without direct price but with nested components
const nestedTree = {
  components: [
    {
      buyPrice: 0,
      sellPrice: 0,
      count: 2,
      components: [
        { buyPrice: 5, sellPrice: 6, count: 1, components: [] }
      ]
    }
  ]
}
assert.deepStrictEqual(calc.calculateComponentsPrice(nestedTree), { buy: 10, sell: 12 })

// Mixed tree
const mixedTree = {
  components: [
    { buyPrice: 1, sellPrice: 2, count: 3, components: [] },
    {
      buyPrice: 0,
      sellPrice: 0,
      count: 2,
      components: [
        { buyPrice: 5, sellPrice: 6, count: 1, components: [] }
      ]
    }
  ]
}
assert.deepStrictEqual(calc.calculateComponentsPrice(mixedTree), { buy: 13, sell: 18 })

  // Component with recipe output count > 1
const multiOutputTree = {
  components: [
    {
      buyPrice: 0,
      sellPrice: 0,
      count: 2,
      recipe: { output_item_count: 3 },
      components: [
        { buyPrice: 3, sellPrice: 6, count: 3, components: [] }
      ]
    }
  ]
}
  assert.deepStrictEqual(calc.calculateComponentsPrice(multiOutputTree), { buy: 18, sell: 36 })

  // Component with parentMultiplier property (ignored)
const parentMultiplierTree = {
  components: [
    {
      buyPrice: 0,
      sellPrice: 0,
      count: 2,
      parentMultiplier: 4,
      components: [
        { buyPrice: 4, sellPrice: 8, count: 4, components: [] }
      ]
    }
  ]
}
  assert.deepStrictEqual(calc.calculateComponentsPrice(parentMultiplierTree), { buy: 32, sell: 64 })

console.log('calculateComponentsPrice test passed')
