import assert from 'assert'

global.window = {}
global.document = {
  getElementById: () => null,
  querySelectorAll: () => []
}

await import('../src/js/bundle-legendary.js')
const { Ingredient } = window.LegendaryUtils

function runTrebolTest(Cls, rootCount, expectedCounts) {
  const root = new Cls(19675, 'Trébol', 'account_bound', null, rootCount)
  expectedCounts.forEach((cnt, i) => {
    const leaf = new Cls(100 + i, 'mat', 'mat', null, rootCount)
    leaf.setPrices(1, 2)
    root.addComponent(leaf)
  })
  const totals = root.calculateTotals(1)
  const sum = expectedCounts.reduce((a, b) => a + b, 0)
  assert.strictEqual(totals.buy, sum)
  assert.strictEqual(totals.sell, sum * 2)
  root.components.forEach(c => {
    assert.strictEqual(c.count, rootCount)
  })
}

runTrebolTest(Ingredient, 77, [250, 250, 250, 1500])
runTrebolTest(Ingredient, 38, [38, 38, 38, 38])

console.log('calculateTotals trebol tests passed')
