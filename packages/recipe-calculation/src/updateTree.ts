import { calculateTreeQuantity } from './calculateTreeQuantity'
import { calculateTreePrices } from './calculateTreePrices'
import { RecipeTreeWithCraftFlags } from './types'

// Cache for already processed subtrees. The key encodes the node id and
// parameters that influence the calculation (amount, prices and available
// quantities). If the prices or requested quantity changes, a new cache key is
// generated and the previous entry is ignored.
const treeCache = new Map<string, RecipeTreeWithCraftFlags>()

function cacheKey(
  nodeId: number,
  amount: number,
  itemPrices: Record<string, number>,
  availableItems: Record<string, number>,
) {
  const pricesKey = Object.keys(itemPrices)
    .sort()
    .map((id) => `${id}:${itemPrices[id]}`)
    .join('|')

  const availableKey = Object.keys(availableItems)
    .sort()
    .map((id) => `${id}:${availableItems[id]}`)
    .join('|')

  return `${nodeId}|${amount}|${pricesKey}|${availableKey}`
}

export function updateTree(
  amount: number,
  tree: RecipeTreeWithCraftFlags,
  itemPrices: Record<string, number>,
  availableItems: Record<string, number> = {}
) {
  const key = cacheKey(tree.id, amount, itemPrices, availableItems)
  const cachedTree = treeCache.get(key)
  if (cachedTree) {
    return cachedTree
  }

  // Update the tree total and used quantities
  const treeWithQuantity = calculateTreeQuantity(amount, tree, availableItems)

  // Recalculate the correct tree price
  const pricedTree = calculateTreePrices(treeWithQuantity, itemPrices)
  treeCache.set(key, pricedTree)
  return pricedTree
}
