import { bags32 } from './data/bags32.js';
import { getPrice } from './utils/priceHelper.js';
import { getItemDetails, getItemBundles } from './services/recipeService.js';
import { runCostsWorkerTask } from './workers/costsWorkerClient.js';
import { formatGoldColored, getRarityClass } from './bundle-utils-1.js';

const DEFAULT_ICON_URL = 'https://render.guildwars2.com/file/0120CB0368B7953F0D3BD2A0C9100BCF0839FF4D/219035.png';

class Ingredient {
  constructor(id, name, type, rarity = null, count = 1, parent = null) {
    this.id = id;
    this.name = name;
    this.type = type || 'material';
    this.rarity = rarity;
    this.count = count || 1;
    this.parent = parent || null;
    this.components = [];
    this.icon = null;
    this._buyPrice = 0;
    this._sellPrice = 0;
    this._priceLoaded = false;
    this.total_buy = 0;
    this.total_sell = 0;
  }

  addComponent(component) {
    if (!component) return;
    this.components.push(component);
    component.parent = this;
  }

  get buyPrice() {
    return this._buyPrice || 0;
  }

  get sellPrice() {
    return this._sellPrice || 0;
  }

  setPrices(buyPrice = 0, sellPrice = 0) {
    const normalizedBuy = Number.isFinite(buyPrice) ? buyPrice : 0;
    const normalizedSell = Number.isFinite(sellPrice) ? sellPrice : 0;
    this._buyPrice = normalizedBuy;
    this._sellPrice = normalizedSell;
    if (normalizedBuy > 0 || normalizedSell > 0) {
      this._priceLoaded = true;
    }
  }

  isPriceLoaded() {
    return this._priceLoaded;
  }

  getTotalBuyPrice() {
    return this.buyPrice * (this.count || 1);
  }

  getTotalSellPrice() {
    return this.sellPrice * (this.count || 1);
  }

  calculateTotals(multiplier = 1) {
    const effective = multiplier * (this.count || 1);

    if (!Array.isArray(this.components) || this.components.length === 0) {
      const buy = this.buyPrice * effective;
      const sell = this.sellPrice * effective;
      this.total_buy = buy;
      this.total_sell = sell;
      return { buy, sell, isCraftable: this.isPriceLoaded() };
    }

    let totalBuy = 0;
    let totalSell = 0;
    let allChildrenPriced = true;

    for (const component of this.components) {
      const totals = component.calculateTotals(effective);
      totalBuy += totals.buy;
      totalSell += totals.sell;
      if (totals.buy <= 0 && totals.sell <= 0) {
        allChildrenPriced = false;
      }
    }

    if (allChildrenPriced && totalBuy > 0 && !this._priceLoaded) {
      const unitBuy = totalBuy / effective;
      const unitSell = totalSell / effective;
      this._buyPrice = unitBuy;
      this._sellPrice = unitSell;
      this._priceLoaded = true;
    }

    const buy = this.buyPrice * effective;
    const sell = this.sellPrice * effective;
    this.total_buy = buy;
    this.total_sell = sell;
    return { buy, sell, isCraftable: allChildrenPriced };
  }
}

function normalizeIcon(icon) {
  if (!icon) return null;
  if (icon.startsWith('http')) {
    return icon;
  }
  const clean = icon.startsWith('file/') ? icon.slice(5) : icon;
  const normalized = clean.startsWith('/') ? clean.slice(1) : clean;
  return `https://render.guildwars2.com/file/${normalized}`;
}

function adaptIngredientForWorker(ingredient) {
  return {
    id: ingredient.id,
    qty: ingredient.count,
    buy_price: ingredient.buyPrice > 0 ? ingredient.buyPrice : null,
    sell_price: ingredient.sellPrice > 0 ? ingredient.sellPrice : null,
    is_craftable: Array.isArray(ingredient.components) && ingredient.components.length > 0,
    children: Array.isArray(ingredient.components)
      ? ingredient.components.map(adaptIngredientForWorker)
      : []
  };
}

function mapQtyToCount(node) {
  if (!node) return;
  node.count = node.qty;
  delete node.qty;
  if (Array.isArray(node.children)) {
    node.children.forEach(mapQtyToCount);
  }
}

function applyWorkerData(src, dest) {
  if (!src || !dest) return;
  dest.total_buy = src.total_buy;
  dest.total_sell = src.total_sell;
  dest.total_crafted = src.total_crafted;
  dest.crafted_price = src.crafted_price;
  if (Array.isArray(src.children) && Array.isArray(dest.components)) {
    for (let i = 0; i < src.children.length && i < dest.components.length; i += 1) {
      applyWorkerData(src.children[i], dest.components[i]);
    }
  }
}

async function runCostsWorker(tree, globalQty = 1) {
  const result = await runCostsWorkerTask({ ingredientTree: tree, globalQty });
  return result || { updatedTree: null, totals: null };
}

class BagCraftingApp {
  constructor({ bags }) {
    this.bags = Array.isArray(bags) ? bags : [];
    this.bagsById = new Map(this.bags.map(bag => [String(bag.id), bag]));

    this.craftingTreeEl = document.getElementById('craftingTree');
    this.skeletonEl = document.getElementById('craftingTreeSkeleton');
    this.summaryEl = document.getElementById('summary');
    this.summaryBuyEl = document.getElementById('summaryBuyPrice');
    this.summarySellEl = document.getElementById('summarySellPrice');
    this.buttons = Array.from(document.querySelectorAll('.bag-nav-button'));

    this.variantContainer = document.getElementById('bagVariantControls');
    this.variantSelect = this.variantContainer?.querySelector('select') || null;

    this.bundleCache = new Map();
    this.itemDetailsCache = new Map();
    this.priceCache = new Map();
    this.workerTotals = { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
    this.currentTree = null;
    this.currentBag = null;
    this.currentVariantId = null;
    this.activeButton = null;
    this.currentRequestId = 0;

    if (this.variantSelect) {
      this.variantSelect.addEventListener('change', event => this.handleVariantChange(event));
    }
  }

  init() {
    if (!this.craftingTreeEl) return;
    this.registerButtons();
    this.buttons.forEach(btn => btn.classList.remove('active'));
    this.activeButton = null;
    this.showPlaceholderMessage();
  }

  registerButtons() {
    this.buttons.forEach(button => {
      button.addEventListener('click', () => {
        this.setActiveButton(button);
        const bagId = button.getAttribute('data-item-id');
        if (bagId) {
          void this.loadBagById(bagId);
        }
      });
    });
  }

  setActiveButton(button) {
    this.buttons.forEach(btn => btn.classList.remove('active'));
    if (button) {
      button.classList.add('active');
      this.activeButton = button;
    } else {
      this.activeButton = null;
    }
  }

  findBagById(bagId) {
    if (!bagId) return null;
    const key = String(bagId);
    return this.bagsById.get(key) || null;
  }

  findVariant(bag, variantId) {
    const variants = Array.isArray(bag?.variants) ? bag.variants : [];
    if (variants.length === 0) {
      return { id: 'default', name: 'Receta estándar', manualIngredients: [] };
    }
    if (variantId != null) {
      const match = variants.find(v => String(v.id) === String(variantId));
      if (match) return match;
    }
    return variants[0];
  }

  async loadBagById(bagId, variantId = null) {
    const requestId = ++this.currentRequestId;
    const bag = this.findBagById(bagId);
    if (!bag) {
      this.showError('No se encontró información de esta alforja.');
      return;
    }

    this.currentBag = bag;
    this.resetSummary();
    this.setLoading(true);
    this.clearTree();
    this.clearMessage();

    const variant = this.findVariant(bag, variantId);
    this.currentVariantId = variant.id;
    this.updateVariantSelector(bag, String(variant.id));

    const manualRoot = {
      id: bag.id,
      name: bag.name,
      count: 1,
      manualIngredients: Array.isArray(variant.manualIngredients) ? variant.manualIngredients : []
    };

    try {
      await this.preloadManualData(manualRoot);
      if (this.currentRequestId !== requestId) {
        return;
      }

      const tree = await this.createIngredientTree(manualRoot);
      if (this.currentRequestId !== requestId) {
        return;
      }

      this.currentTree = tree;
      await this.updateTotals();
      if (this.currentRequestId !== requestId) {
        return;
      }

      await this.renderTree();
      this.renderSummary();
      if (this.summaryEl) {
        this.summaryEl.classList.remove('hidden');
        this.summaryEl.style.display = 'block';
      }
    } catch (error) {
      console.error('[BagCraftingApp] Error al cargar el árbol de ingredientes', error);
      if (this.currentRequestId === requestId) {
        this.showError('No se pudo cargar el detalle de crafteo. Intenta de nuevo más tarde.');
      }
    } finally {
      if (this.currentRequestId === requestId) {
        this.setLoading(false);
      }
    }
  }

  async createIngredientTree(manualIngredient, parent = null) {
    if (!manualIngredient || !manualIngredient.id) {
      return null;
    }

    const count = Number(manualIngredient.count) || 1;
    const key = String(manualIngredient.id);
    const bundle = this.bundleCache.get(key) || null;

    let details = this.itemDetailsCache.get(key) || null;
    if (!details && bundle?.item) {
      const itemData = { ...bundle.item };
      if (itemData.icon) {
        itemData.icon = normalizeIcon(itemData.icon);
      }
      details = itemData;
      this.itemDetailsCache.set(key, details);
    }

    if (!details) {
      details = await this.fetchItemDetails(manualIngredient.id);
    }

    const name = manualIngredient.name || details?.name || `Item ${manualIngredient.id}`;
    const ingredient = new Ingredient(
      manualIngredient.id,
      name,
      details?.type || manualIngredient.type || null,
      details?.rarity || null,
      count,
      parent
    );

    if (details?.icon) {
      ingredient.icon = details.icon;
    }

    let price = this.priceCache.has(key) ? this.priceCache.get(key) : null;
    if (!price) {
      const market = this.normalizeMarketData(bundle?.market);
      if (market) {
        price = market;
        this.priceCache.set(key, price);
      }
    }

    if (!price) {
      price = await this.fetchItemPrice(manualIngredient.id);
    }

    if (price) {
      const buyPrice = Number.isFinite(price.buy_price) ? price.buy_price : price.buys?.unit_price;
      const sellPrice = Number.isFinite(price.sell_price) ? price.sell_price : price.sells?.unit_price;
      ingredient.setPrices(buyPrice, sellPrice);
    }

    const children = Array.isArray(manualIngredient.manualIngredients)
      ? manualIngredient.manualIngredients
      : [];

    if (children.length > 0) {
      const childNodes = await Promise.all(
        children.map(child => this.createIngredientTree(child, ingredient))
      );
      childNodes.filter(Boolean).forEach(child => ingredient.addComponent(child));
    }

    return ingredient;
  }

  normalizeMarketData(market) {
    if (!market || typeof market !== 'object') {
      return null;
    }

    const toNumber = value => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const buyCandidates = [
      market.buy_price,
      market.buyPrice,
      market?.buys?.unit_price
    ];
    const sellCandidates = [
      market.sell_price,
      market.sellPrice,
      market?.sells?.unit_price
    ];

    const buy = buyCandidates.map(toNumber).find(value => value != null);
    const sell = sellCandidates.map(toNumber).find(value => value != null);

    if (buy == null && sell == null) {
      return null;
    }

    return {
      buy_price: buy ?? null,
      sell_price: sell ?? null
    };
  }

  collectManualIds(manualIngredient, acc = new Set()) {
    if (!manualIngredient || typeof manualIngredient !== 'object') {
      return acc;
    }

    if (manualIngredient.id != null) {
      const numericId = Number(manualIngredient.id);
      if (Number.isFinite(numericId)) {
        acc.add(numericId);
      }
    }

    const children = Array.isArray(manualIngredient.manualIngredients)
      ? manualIngredient.manualIngredients
      : [];
    children.forEach(child => this.collectManualIds(child, acc));

    const variants = Array.isArray(manualIngredient.variants)
      ? manualIngredient.variants
      : [];
    variants.forEach(variant => {
      if (!variant || typeof variant !== 'object') {
        return;
      }
      if (variant.id != null) {
        const variantId = Number(variant.id);
        if (Number.isFinite(variantId)) {
          acc.add(variantId);
        }
      }
      const variantChildren = Array.isArray(variant.manualIngredients)
        ? variant.manualIngredients
        : [];
      variantChildren.forEach(child => this.collectManualIds(child, acc));
    });

    return acc;
  }

  async preloadManualData(manualRoot) {
    const ids = Array.from(this.collectManualIds(manualRoot));
    if (!ids.length) {
      return;
    }

    try {
      const bundles = await getItemBundles(ids);
      if (!Array.isArray(bundles)) {
        return;
      }

      bundles.forEach((bundle, index) => {
        const itemId = ids[index];
        this.storeBundleInCaches(itemId, bundle);
      });
    } catch (error) {
      console.warn('[BagCraftingApp] No se pudieron precargar los datos de recetas', error);
    }
  }

  storeBundleInCaches(itemId, bundle) {
    const key = String(itemId);
    this.bundleCache.set(key, bundle || null);

    const item = bundle?.item || null;
    if (item) {
      const normalizedItem = { ...item };
      if (normalizedItem.icon) {
        normalizedItem.icon = normalizeIcon(normalizedItem.icon);
      }
      this.itemDetailsCache.set(key, normalizedItem);
    }

    const market = this.normalizeMarketData(bundle?.market);
    if (market) {
      this.priceCache.set(key, market);
    }
  }

  async fetchItemDetails(itemId) {
    const key = String(itemId);
    if (this.itemDetailsCache.has(key)) {
      return this.itemDetailsCache.get(key);
    }

    const bundle = this.bundleCache.get(key);
    if (bundle?.item) {
      const normalized = { ...bundle.item };
      if (normalized.icon) {
        normalized.icon = normalizeIcon(normalized.icon);
      }
      this.itemDetailsCache.set(key, normalized);
      return normalized;
    }

    try {
      const details = await getItemDetails(itemId);
      if (details && details.icon) {
        details.icon = normalizeIcon(details.icon);
      }
      this.itemDetailsCache.set(key, details || null);
      return details || null;
    } catch (error) {
      console.warn(`[BagCraftingApp] No se pudo obtener detalles para el ítem ${itemId}`, error);
      this.itemDetailsCache.set(key, null);
      return null;
    }
  }

  async fetchItemPrice(itemId) {
    const key = String(itemId);
    if (this.priceCache.has(key)) {
      return this.priceCache.get(key);
    }

    const bundle = this.bundleCache.get(key);
    const market = this.normalizeMarketData(bundle?.market);
    if (market) {
      this.priceCache.set(key, market);
      return market;
    }

    try {
      const price = await getPrice(itemId);
      this.priceCache.set(key, price || null);
      return price || null;
    } catch (error) {
      console.warn(`[BagCraftingApp] No se pudo obtener precio de mercado para el ítem ${itemId}`, error);
      this.priceCache.set(key, null);
      return null;
    }
  }

  async updateTotals() {
    if (!this.currentTree) {
      this.workerTotals = { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
      return this.workerTotals;
    }

    try {
      const adapted = adaptIngredientForWorker(this.currentTree);
      const treeForWorker = [adapted];
      treeForWorker.forEach(mapQtyToCount);
      const { updatedTree, totals } = await runCostsWorker(treeForWorker, 1);
      if (Array.isArray(updatedTree) && updatedTree[0]) {
        applyWorkerData(updatedTree[0], this.currentTree);
      }
      this.workerTotals = totals || { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
      return this.workerTotals;
    } catch (error) {
      console.warn('[BagCraftingApp] Worker de costos no disponible, usando cálculo local', error);
      const fallback = this.currentTree.calculateTotals();
      this.workerTotals = {
        totalBuy: fallback.buy || 0,
        totalSell: fallback.sell || 0,
        totalCrafted: fallback.buy || 0
      };
      return this.workerTotals;
    }
  }

  async renderTree() {
    if (!this.craftingTreeEl) return;
    this.craftingTreeEl.innerHTML = '';
    if (!this.currentTree) return;
    await this.renderIngredient(this.currentTree, this.craftingTreeEl, 0);
  }

  async renderIngredient(ingredient, container, depth = 0) {
    if (!ingredient) return;

    const hasChildren = Array.isArray(ingredient.components) && ingredient.components.length > 0;
    const isExpanded = depth < 2;
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'item-wrapper-treeleg';

    const totalBuy = Number.isFinite(ingredient.total_buy) && ingredient.total_buy > 0
      ? ingredient.total_buy
      : ingredient.getTotalBuyPrice();
    const totalSell = Number.isFinite(ingredient.total_sell) && ingredient.total_sell > 0
      ? ingredient.total_sell
      : ingredient.getTotalSellPrice();

    const hasBuyPrice = totalBuy > 0;
    const hasSellPrice = totalSell > 0;
    const priceAvailable = hasBuyPrice || hasSellPrice;

    const priceContent = priceAvailable
      ? `<div class="price-row"><span class="price-label">Compra:</span><span class="price-amount">${hasBuyPrice ? formatGoldColored(totalBuy) : 'N/A'}</span></div>
         <div class="price-row"><span class="price-label">Venta:</span><span class="price-amount">${hasSellPrice ? formatGoldColored(totalSell) : 'N/A'}</span></div>`
      : '<div class="price-row"><span class="price-label">Precio:</span><span class="price-amount">N/A</span></div>';

    const iconUrl = this.getIconUrl(ingredient);
    const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(ingredient.rarity) : '';

    itemWrapper.innerHTML = `
      <div class="item-card-treeleg">
        ${hasChildren ? `<button class="toggle-children" data-expanded="${isExpanded}">${isExpanded ? '−' : '+'}</button>` : '<div style="width: 24px;"></div>'}
        <img class="item-icon" src="${iconUrl}" alt="${ingredient.name || 'Item'}" onerror="this.onerror=null;this.src='${DEFAULT_ICON_URL}';">
        <div class="item-name ${rarityClass}">
          ${ingredient.name || 'Item'}
        </div>
        <div class="item-details">
          ${ingredient.count > 1 ? `<span class="item-count">x${Math.round(ingredient.count)}</span>` : ''}
          <div class="item-price-container ${priceAvailable ? 'has-price' : 'no-price'}">
            ${priceContent}
          </div>
        </div>
      </div>`;

    container.appendChild(itemWrapper);

    if (hasChildren) {
      const toggleBtn = itemWrapper.querySelector('.toggle-children');
      const subItemsEl = document.createElement('div');
      subItemsEl.className = 'sub-items';
      subItemsEl.style.display = isExpanded ? 'block' : 'none';
      container.appendChild(subItemsEl);

      if (toggleBtn) {
        toggleBtn.addEventListener('click', event => {
          event.stopPropagation();
          const expanded = toggleBtn.getAttribute('data-expanded') === 'true';
          if (expanded) {
            subItemsEl.style.display = 'none';
            toggleBtn.textContent = '+';
            toggleBtn.setAttribute('data-expanded', 'false');
          } else {
            subItemsEl.style.display = 'block';
            toggleBtn.textContent = '−';
            toggleBtn.setAttribute('data-expanded', 'true');
          }
        });
      }

      for (const child of ingredient.components) {
        await this.renderIngredient(child, subItemsEl, depth + 1);
      }
    }
  }

  getIconUrl(ingredient) {
    if (!ingredient) return DEFAULT_ICON_URL;
    if (ingredient.icon) return ingredient.icon;
    return DEFAULT_ICON_URL;
  }

  renderSummary() {
    if (!this.summaryEl || !this.summaryBuyEl || !this.summarySellEl || !this.currentTree) {
      return;
    }

    const totalBuy = Number.isFinite(this.workerTotals.totalBuy) && this.workerTotals.totalBuy > 0
      ? this.workerTotals.totalBuy
      : this.currentTree.getTotalBuyPrice();
    const totalSell = Number.isFinite(this.workerTotals.totalSell) && this.workerTotals.totalSell > 0
      ? this.workerTotals.totalSell
      : this.currentTree.getTotalSellPrice();

    this.summaryBuyEl.innerHTML = totalBuy > 0 ? formatGoldColored(totalBuy) : 'N/A';
    this.summarySellEl.innerHTML = totalSell > 0 ? formatGoldColored(totalSell) : 'N/A';
  }

  resetSummary() {
    if (this.summaryBuyEl) this.summaryBuyEl.textContent = '-';
    if (this.summarySellEl) this.summarySellEl.textContent = '-';
  }

  clearTree() {
    if (this.craftingTreeEl) {
      this.craftingTreeEl.innerHTML = '';
    }
  }

  setLoading(isLoading) {
    if (this.skeletonEl) {
      this.skeletonEl.classList.toggle('hidden', !isLoading);
    }
    if (this.summaryEl) {
      if (isLoading) {
        this.summaryEl.style.display = 'none';
      }
    }
  }

  showPlaceholderMessage() {
    this.showMessage('Selecciona una alforja para ver los detalles de crafteo.');
  }

  showMessage(message, { type = 'info', hideSummary = true } = {}) {
    if (!this.craftingTreeEl) return;
    const typeClass = type === 'error' ? ' error' : '';
    this.craftingTreeEl.innerHTML = `<div class="message${typeClass}">${message}</div>`;
    if (hideSummary && this.summaryEl) {
      this.summaryEl.style.display = 'none';
    }
  }

  showError(message) {
    this.showMessage(message, { type: 'error' });
  }

  clearMessage() {
    if (this.craftingTreeEl) {
      this.craftingTreeEl.innerHTML = '';
    }
  }

  updateVariantSelector(bag, selectedVariantId) {
    if (!this.variantContainer || !this.variantSelect) {
      return;
    }

    const variants = Array.isArray(bag?.variants) ? bag.variants : [];
    if (variants.length <= 1) {
      this.variantContainer.classList.add('hidden');
      this.variantSelect.innerHTML = '';
      return;
    }

    this.variantSelect.innerHTML = '';
    variants.forEach(variant => {
      const option = document.createElement('option');
      option.value = String(variant.id);
      option.textContent = variant.name || 'Variante';
      this.variantSelect.appendChild(option);
    });

    const optionToSelect = Array.from(this.variantSelect.options).find(
      option => option.value === String(selectedVariantId)
    );
    if (optionToSelect) {
      this.variantSelect.value = optionToSelect.value;
    } else if (this.variantSelect.options.length > 0) {
      this.variantSelect.selectedIndex = 0;
      this.currentVariantId = this.variantSelect.value;
    }

    this.variantContainer.classList.remove('hidden');
  }

  handleVariantChange(event) {
    if (!this.currentBag) return;
    const select = event?.target;
    if (!select) return;
    const variantId = select.value;
    if (!variantId || String(variantId) === String(this.currentVariantId)) {
      return;
    }
    this.currentVariantId = variantId;
    void this.loadBagById(this.currentBag.id, variantId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new BagCraftingApp({ bags: bags32 });
  app.init();
  if (typeof window !== 'undefined') {
    window.bagCraftingApp = app;
  }
});

export { Ingredient };
