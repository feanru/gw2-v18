import assert from 'assert'
import { getConfig } from '../src/js/config.js'
import { preloadPrices, getPrice, clearCache } from '../src/js/utils/priceHelper.js'

// Ensure we use the JSON branch and avoid sessionStorage
globalThis.window = {
  ...(globalThis.window || {}),
  __RUNTIME_CONFIG__: {
    ...(globalThis.window?.__RUNTIME_CONFIG__ || {}),
    priceCacheStrategy: 'redis'
  }
}

assert.equal(getConfig().priceCacheStrategy, 'redis')

global.fetch = async () => ({
  ok: true,
  json: async () => [
    { id: 1, market: { buy_price: 10, sell_price: 20 } },
    { id: 2, market: { buy_price: 30, sell_price: 40 } }
  ]
})

clearCache()
const map = await preloadPrices([1, 2])
assert.ok(map instanceof Map)
assert.equal(map.get(1).buy_price, 10)
assert.equal(map.get(2).sell_price, 40)

const price = await getPrice(1)
assert.equal(price.buy_price, 10)

console.log('price-helper-map test passed')
