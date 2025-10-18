import assert from 'assert'

global.window = {}
global.document = {
  getElementById: () => null,
  querySelectorAll: () => []
}

await import('../src/js/bundle-legendary.js')
const { Ingredient } = window.LegendaryUtils

// Caso 77: aplicar multiplicador externo a hojas
const leaf77 = () => {
  const ing = new Ingredient(1, 'mat', 'mat', null, 1)
  ing.setPrices(1, 2)
  return ing
}
const root77 = new Ingredient(19675, 'Trébol', 'account_bound', null, 1)
;[leaf77(), leaf77(), leaf77(), leaf77()].forEach(c => root77.addComponent(c))
const totals77 = root77.calculateTotals(77)
assert.strictEqual(totals77.buy, 4 * 77)
assert.strictEqual(totals77.sell, 4 * 77 * 2)
root77.components.forEach(c => {
  const t = c.calculateTotals(77)
  assert.strictEqual(t.buy, 77)
  assert.strictEqual(t.sell, 154)
})

// Caso 38: multiplicador diferente
const leaf38 = () => {
  const ing = new Ingredient(1, 'mat', 'mat', null, 1)
  ing.setPrices(1, 2)
  return ing
}
const root38 = new Ingredient(19675, 'Trébol', 'account_bound', null, 1)
;[leaf38(), leaf38(), leaf38(), leaf38()].forEach(c => root38.addComponent(c))
const totals38 = root38.calculateTotals(38)
assert.strictEqual(totals38.buy, 4 * 38)
assert.strictEqual(totals38.sell, 4 * 38 * 2)
root38.components.forEach(c => {
  const t = c.calculateTotals(38)
  assert.strictEqual(t.buy, 38)
  assert.strictEqual(t.sell, 76)
})

console.log('calculateTotals multiplier tests passed')
