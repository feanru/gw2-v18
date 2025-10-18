// GW2 Item Tracker v2 - UI Y PRESENTACIÓN (item-ui.js)
import {
  setIngredientObjs,
  setGlobalQty,
  snapshotExpandState,
  restoreExpandState,
  findIngredientByUid,
  calcPercent,
  recalcAll,
  getTotals
} from './items-core.js';
import {
  showSkeleton,
  hideSkeleton,
  showError,
  hideError,
  setQtyInputValue,
  getQtyInputValue
} from './ui-helpers.js';
import { isFeatureEnabled } from './utils/featureFlags.js';

function runIdleTasks(tasks) {
  const scheduleIdle = (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
    ? window.requestIdleCallback.bind(window)
    : (cb) => {
      const start = Date.now();
      return setTimeout(() => cb({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
      }), 0);
    };

  function runner(deadline) {
    const idleDeadline = deadline || { timeRemaining: () => 0 };
    while (idleDeadline.timeRemaining() > 0 && tasks.length) {
      const task = tasks.shift();
      if (typeof task === 'function') task();
    }
    if (tasks.length) scheduleIdle(runner);
  }

  scheduleIdle(runner);
}

// Functions imported from items-core.js provide shared logic

// --- Helpers para el input de cantidad global (definidos en ui-helpers.js) ---

function isEquivalentParentId(a, b) {
  const nullLikes = [null, undefined, "null", ""];
  return (nullLikes.includes(a) && nullLikes.includes(b)) || String(a) === String(b);
}

// --- Helpers visuales ---

// --- DEPURACIÓN: Verifica que todos los ingredientes y subingredientes tengan id válido ---
function checkTreeForInvalidIds(ings, path = "") {
  if (!Array.isArray(ings)) return;
  for (const ing of ings) {
    if (!ing || typeof ing.id === "undefined" || ing.id === null) {
      console.warn("Ingrediente sin id válido en ruta:", path, ing);
    }
    if (Array.isArray(ing.children)) {
      checkTreeForInvalidIds(ing.children, path + " > " + (ing.name || ing.id));
    }
  }
}
window.checkTreeForInvalidIds = checkTreeForInvalidIds;

// Llama a esto tras inicializar window.ingredientObjs, antes de renderizar:
// checkTreeForInvalidIds(window.ingredientObjs);




function renderWiki(name, nameEn = null) {
  if (!name) return;
  const wikiLinksEl = document.getElementById('wiki-links');
  if (!wikiLinksEl) return;
  const nombre = encodeURIComponent(name.replaceAll(' ', '_'));
  const englishSource = (typeof nameEn === 'string' && nameEn.trim() !== '') ? nameEn : name;
  const nombreEn = encodeURIComponent(englishSource.replaceAll(' ', '_'));
  const wikiES = `https://wiki.guildwars2.com/wiki/es:${nombre}`;
  const wikiEN = `https://wiki.guildwars2.com/wiki/${nombreEn}`;
  wikiLinksEl.innerHTML = `
    <div class="wiki-links">
      <a href="${wikiES}" target="_blank">Wiki en Español</a>
      <a href="${wikiEN}" target="_blank">Wiki en Inglés</a>
    </div>
  `;
}

// --- Helpers de UI definidos en ui-helpers.js ---

// Inicializa el mapa de expansión principal por id
if (typeof window._mainItemExpandedMap === 'undefined') {
  window._mainItemExpandedMap = {};
}
// Handler para el botón de expandir/collapse principal
if (!window._mainExpandBtnHandlerInstalled) {
  window._mainExpandBtnHandlerInstalled = true;
  document.addEventListener('click', function(e) {
    // Handler para expandir/collapse principal
    if (e.target && e.target.classList.contains('btn-expand-main')) {
      const mainId = e.target.getAttribute('data-id');
      if (!mainId) return;
      window._mainItemExpandedMap[mainId] = !window._mainItemExpandedMap[mainId];
      if (typeof safeRenderTable === 'function') safeRenderTable();
      e.stopPropagation();
    }
  });
  // Handler global SEPARADO para eliminar ítem principal
  document.addEventListener('click', function(e) {
    if (e.target && (e.target.classList.contains('btn-delete-main') || (typeof e.target.closest === 'function' && e.target.closest('.btn-delete-main')))) {
      let deleteBtn = e.target;
      if (!deleteBtn.classList.contains('btn-delete-main') && typeof deleteBtn.closest === 'function') {
        deleteBtn = deleteBtn.closest('.btn-delete-main');
      }
      if (!deleteBtn) return;
      const mainId = deleteBtn.getAttribute('data-id');
      if (!mainId) return;
      if (window.ingredientObjs && Array.isArray(window.ingredientObjs)) {
        window.ingredientObjs = window.ingredientObjs.filter(ing => String(ing.id) !== String(mainId));
        if (window._mainItemExpandedMap) delete window._mainItemExpandedMap[mainId];
      }
      if (window.comparativa?.clearComparativaMeta) {
        window.comparativa.clearComparativaMeta(mainId);
      }
      if (typeof safeRenderTable === 'function') safeRenderTable();
      e.stopPropagation();
    }
  });
}

// --- Handler para cambio de modo (buy/sell/crafted) ---
if (!window._modeChangeHandlerInstalled) {
  window._modeChangeHandlerInstalled = true;
  document.addEventListener('click', function(e) {
    const target = e.target;
    if (target.matches('.chk-mode-buy, .chk-mode-sell, .chk-mode-crafted')) {
      const path = target.getAttribute('data-path');
      if (!path) return;

      const uid = path.split('-').pop();
      const ingredient = findIngredientByUid(window.ingredientObjs || [], uid);

      if (ingredient) {
        let newMode = 'buy';
        if (target.classList.contains('chk-mode-sell')) newMode = 'sell';
        if (target.classList.contains('chk-mode-crafted')) newMode = 'crafted';
        // Llamamos al nuevo método si está disponible, sino ajustamos manualmente
        if (typeof ingredient.setMode === 'function') {
          // Llamamos al nuevo método que se encarga de todo: recalcular y volver a renderizar
          ingredient.setMode(newMode);
        } else {
          ingredient.modeForParentCrafted = newMode;
          ingredient.findRoot()?.recalc(window.globalQty || 1, null);
          if (typeof safeRenderTable === 'function') safeRenderTable();
        }
      }
    }
  });
}

// Handler global para expandir/collapse ingredientes hijos
// DEPURACIÓN: logs antes y después de buscar/cambiar expanded
if (!window._expandBtnHandlerInstalled) {
  window._expandBtnHandlerInstalled = true;
  // Handler único para expand/collapse por data-path está en installUIEvents o más abajo.
}


// Renderiza la fila del item principal (crafteable)
function renderMainItemRow(mainItem, qty, totalBuy, totalSell, totalCrafted) {
  // Usa SIEMPRE los totales calculados en el nodo raíz tras recalc.
  // getTotals() entrega los totales globales calculados por recalcAll.
  // Esto mantiene la misma lógica que en item.js y evita desincronizaciones.
  const realTotals = {
    totalBuy: mainItem.total_buy,
    totalSell: mainItem.total_sell,
    totalCrafted:
      (mainItem.total_crafted !== undefined && mainItem.total_crafted !== null)
        ? mainItem.total_crafted
        : getTotals().totalCrafted
  };

  if (!mainItem) return '';
  const expanded = !!window._mainItemExpandedMap[mainItem.id];
  const btnExpand = `<button class="btn-expand btn-expand-main" id="btn-expand-main-${mainItem.id}" data-id="${mainItem.id}">${expanded ? '▴' : '▾'}</button>`;
  const btnDelete = `<button class="btn-delete-main" data-id="${mainItem.id}" title="Eliminar">-</button>`;
  const btn = `${btnExpand} ${btnDelete}`;
  const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(mainItem.rarity) : '';
  return `
    <tr class="row-bg-main">
      <td class="th-border-left-items"><img src="${mainItem.icon}" width="32"></td>
      <td><a href="/item?id=${mainItem.id}" class="item-link ${rarityClass}" target="_blank">${(mainItem.recipe && mainItem.recipe.output_item_count && mainItem.recipe.output_item_count > 1) ? `<span style='color:#a1a1aa;font-size:0.95em;display:block;margin-bottom:2px;'>Receta produce <b>${mainItem.recipe.output_item_count}</b> unidades<br>Profit mostrado es por unidad</span>` : ''}${mainItem.name}</a></td>
      <td>${qty}</td>
      <td class="item-unit-sell">${formatGoldColored(Number(mainItem.sell_price))} <span style="color: #c99b5b">c/u</span></td>
      <td class="item-solo-buy"><div>${formatGoldColored(realTotals.totalBuy)}</div></td>
      <td class="item-solo-sell"><div>${formatGoldColored(realTotals.totalSell)}</div></td>
      <td class="item-solo-crafted"><div>${formatGoldColored(realTotals.totalCrafted)}</div></td>
      <td class="item-profit">${(() => {
        const ventaBruta = Number(mainItem.sell_price) * qty;
        const ventaNeta = ventaBruta - (ventaBruta * 0.15);
        const minTotal = Math.min(realTotals.totalBuy, realTotals.totalSell, realTotals.totalCrafted);
        const profit = ventaNeta - minTotal;
        const color = profit > 0 ? '#4fc178' : '#e84d4d';
        return `<span style='font-weight:bold;color:${color}'>${formatGoldColored(profit)}</span>`;
      })()}</td>
      <td class="th-border-right-items"><div style="display:flex;gap:6px;align-items:center;">${btn}</div></td>
    </tr>
  `;

}

// --- Renderizado recursivo de ingredientes ---
function renderRows(ings, nivel = 0, parentUid = null, rowGroupIndex = 0, parentExpanded = true, path = []) {
  if (!ings || !Array.isArray(ings)) return '';

  return ings.map((ing, idx) => {
    if (!ing || typeof ing.id === 'undefined') {
      console.warn('Ingrediente inválido en renderRows:', ing);
      return '';
    }
    
    const groupIdx = nivel === 0 ? idx : rowGroupIndex;
    const rowBgClass = groupIdx % 2 === 0 ? 'row-bg-a' : 'row-bg-b';
    const indent = nivel > 0 ? `style="padding-left:${nivel * 30}px"` : '';
    const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(ing.rarity) : '';
    const currentPath = [...path, ing._uid].join('-');
    const expandButton = (ing.children && ing.children.length)
      ? `<button class="btn-expand" data-path="${currentPath}">${ing.expanded ? '▴' : '▾'}</button>` : '';
    
    const isChild = nivel > 0;
    const extraStyle = isChild && !parentExpanded ? 'style="display:none"' : '';
    
    const radioName = `mode-${currentPath}`;
    const radios = isChild ? `
      <input type="radio" name="${radioName}" class="chk-mode-buy" data-path="${currentPath}" ${ing.modeForParentCrafted === 'buy' ? 'checked' : ''} title="Usar precio de compra para el padre">
    ` : '';
    const radiosSell = isChild ? `
      <input type="radio" name="${radioName}" class="chk-mode-sell" data-path="${currentPath}" ${ing.modeForParentCrafted === 'sell' ? 'checked' : ''} title="Usar precio de venta para el padre">
    ` : '';
    const radiosCrafted = (isChild && ing.is_craftable && ing.children && ing.children.length > 0) ? `
      <input type="radio" name="${radioName}" class="chk-mode-crafted" data-path="${currentPath}" ${ing.modeForParentCrafted === 'crafted' ? 'checked' : ''} title="Usar precio de crafteo para el padre">
    ` : '';

    // El total de profit solo tiene sentido para el nodo raíz
    const profitHtml = (() => {
        // Mostrar profit SOLO si el ingrediente es padre (tiene hijos) y tiene precio de mercado
        if (!(ing.children && ing.children.length > 0 && Number(ing.sell_price) > 0)) {
          return '';
        }
        const ventaBruta = Number(ing.sell_price) * ing.countTotal;
        const ventaNeta = ventaBruta - (ventaBruta * 0.15);
        const minTotal = Math.min(ing.total_buy, ing.total_sell, ing.total_crafted);
        const profit = ventaNeta - minTotal;
        const color = profit > 0 ? '#4fc178' : '#e84d4d';
        return `<span style='font-weight:bold;color:${color}'>${formatGoldColored(profit)}</span>`;
    })();

    const noMarketPrice = (!ing.buy_price && !ing.sell_price);
    const noCraftedMarketPrice = ing.is_craftable && ing.children && ing.children.length > 0;

    return `
      <tr data-path="${currentPath}" class="${isChild ? `subrow subrow-${nivel} child-of-${parentUid}` : ''} ${rowBgClass}" ${extraStyle}>
        <td class="th-border-left-items" ${indent}><img src="${ing.icon}" width="32"></td>
        <td><a href="/item?id=${ing.id}" class="item-link ${rarityClass}" target="_blank">${ing.name}</a></td>
        <td>${(ing.countTotal != null) ? (Number.isInteger(ing.countTotal) ? ing.countTotal : ing.countTotal.toFixed(2)) : ing.count}</td>
        <td class="item-unit-sell">${formatGoldColored(ing.sell_price)} <span style="color: #c99b5b">c/u</span></td>
        
        <td class="item-solo-buy">
          <div>${formatGoldColored(ing.total_buy)}</div>
          <div class="item-solo-precio">${formatGoldColored(ing.buy_price)} <span style="color: #c99b5b">c/u</span></div>
          ${radios}
        </td>
        
        <td class="item-solo-sell">
          <div>${formatGoldColored(ing.total_sell)}</div>
          <div class="item-solo-precio">${formatGoldColored(ing.sell_price)} <span style="color: #c99b5b">c/u</span></div>
          ${radiosSell}
        </td>
        
        <td class="item-solo-crafted">
          ${(ing.is_craftable && ing.children && ing.children.length > 0 && ing.total_crafted !== null) ? `
            <div>${formatGoldColored(ing.total_crafted)}</div>
            <div class="item-solo-precio">${formatGoldColored(0)} <span style="color: #c99b5b">c/u</span></div>
            ${radiosCrafted}` : ''
          }
        </td>
        
        <td class="item-profit">${profitHtml}</td>
        
        <td class="th-border-right-items">${expandButton}</td>
      </tr>
      ${(ing.children && ing.children.length && parentExpanded && ing.expanded) ? renderRows(ing.children, nivel + 1, ing._uid, groupIdx, ing.expanded, [...path, ing._uid]) : ''}
    `;
  }).join('');
}

// --- Asegura que todos los ingredientes inicien colapsados ---
function setAllExpandedFalse(ings) {
  for (const ing of ings) {
    ing.expanded = false;
    if (Array.isArray(ing.children)) setAllExpandedFalse(ing.children);
  }
}

// --- Asigna _parentId de forma robusta a todo el árbol ---
function asignarParentIds(nodos, parentUid = "") {
  nodos.forEach(ing => {
    ing._parentId = parentUid !== null ? String(parentUid) : "";
    if (Array.isArray(ing.children)) {
      asignarParentIds(ing.children, ing._uid);
    }
  });
}
if (window.ingredientObjs) asignarParentIds(window.ingredientObjs);

// --- Comparación robusta de parentId ---

// --- Función para mostrar/ocultar el input de cantidad global ---
function updateQtyInputVisibility(show) {
  const qtyContainer = document.querySelector('.qty-global-container');
  if (qtyContainer) {
    if (show) {
      qtyContainer.classList.add('visible');
    } else {
      qtyContainer.classList.remove('visible');
    }
  }
}

// --- Renderizado de la sección 7: Ingredientes para craftear ---
function renderCraftingSectionUI(totals, buyPrice = window._mainBuyPrice, sellPrice = window._mainSellPrice) {
  if (buyPrice == null) buyPrice = window._mainBuyPrice;
  if (sellPrice == null) sellPrice = window._mainSellPrice;
  if (typeof window._mainItemExpanded === 'undefined') window._mainItemExpanded = false;

  // Mostrar/ocultar el input de cantidad global según si hay ingredientes
  const hasIngredients = window.ingredientObjs && window.ingredientObjs.length > 0;
  updateQtyInputVisibility(hasIngredients);
  // --- DEBUG: Mostrar todos los valores clave ---

  // Obtener output_item_count de la receta principal
  const outputCount = (window._mainRecipeOutputCount && !isNaN(window._mainRecipeOutputCount)) ? window._mainRecipeOutputCount : 1;
  const qtyValue = (typeof getQtyInputValue() !== 'undefined' ? getQtyInputValue() : window.globalQty);
  const precioCompraTotal = (buyPrice != null) ? buyPrice * window.globalQty : 0;
  // Suma el sell_price de todos los ítems raíz
  const totalSellPrice = window.ingredientObjs.reduce((sum, ing) => sum + (Number(ing.sell_price) || 0), 0);
  const precioVentaTotal = totalSellPrice * window.globalQty;
  const precioCraftingMinTotal = Math.min(totals.totalBuy, totals.totalSell, totals.totalCrafted);
  const precioCraftingMinUnidad = outputCount > 0 ? precioCraftingMinTotal / outputCount : precioCraftingMinTotal;
  const precioCompraUnidad = outputCount > 0 ? precioCompraTotal / outputCount : precioCompraTotal;
  const precioVentaUnidad = outputCount > 0 ? (totalSellPrice / outputCount) : totalSellPrice;
  const preciosFinales = [precioCompraTotal, precioVentaTotal, precioCraftingMinTotal];
  const preciosFinalesValidos = preciosFinales.filter(x => typeof x === 'number' && x > 0);
  const precioMinimoFinal = preciosFinalesValidos.length ? Math.min(...preciosFinalesValidos) : null;
  const minIdx = precioMinimoFinal != null ? preciosFinales.indexOf(precioMinimoFinal) : -1;
  let mensaje = 'Sin datos de mercado';
  if (minIdx === 0) mensaje = 'Mejor comprar (Buy)';
  else if (minIdx === 1) mensaje = 'Mejor vender (Sell)';
  else if (minIdx === 2) mensaje = 'Mejor craftear (Crafted)';

  // Profit
  let profitHtml = '';
  let profitHtmlUnidad = '';
  // --- Lógica y estructura idéntica a item-ui.js ---
  // Variables para profit total (outputCount === 1)
  const ventaTrasComisionTotal = precioVentaTotal - (precioVentaTotal * 0.15);
  const profitBuyTotal = ventaTrasComisionTotal - totals.totalBuy;
  const profitSellTotal = ventaTrasComisionTotal - totals.totalSell;
  const profitCraftedTotal = ventaTrasComisionTotal - totals.totalCrafted;
  // Variables para profit por unidad (outputCount > 1)
  const precioVentaUnidadMercado = (sellPrice != null) ? sellPrice : 0;
  const ventaTrasComisionUnidadMercado = precioVentaUnidadMercado - (precioVentaUnidadMercado * 0.15);
  const profitBuyUnidadMercado = ventaTrasComisionUnidadMercado - (totals.totalBuy / outputCount);
  const profitSellUnidadMercado = ventaTrasComisionUnidadMercado - (totals.totalSell / outputCount);
  const profitCraftedUnidadMercado = ventaTrasComisionUnidadMercado - (totals.totalCrafted / outputCount);

  if (outputCount === 1) {
    profitHtml = '';
  }
  if (outputCount > 1) {
    profitHtmlUnidad = '';
  }

  // Tablas de totales
  let tablaTotales = `<div class="table-modern-totales">
    <h3>Precio total materiales - Crafting</h3>
    <div id="totales-crafting">      
      <table class="table-totales" style="margin-top:12px;">
        <tr>
          <th><div class="tooltip-modern">Total Compra
            <span class="tooltiptext-modern">Suma total si haces PEDIDO de materiales en el mercado.</span>
          </div></th>
          <td class="item-solo-buy">${formatGoldColored(totals.totalBuy)}</td>
          <th><div class="tooltip-modern">Total Venta
            <span class="tooltiptext-modern">Suma total si COMPRAS materiales en el mercado.</span>
          </div></th>
          <td class="item-solo-sell">${formatGoldColored(totals.totalSell)}</td>
          <th><div class="tooltip-modern">Total Crafted
            <span class="tooltiptext-modern">Suma total si CRAFTEAS todos los materiales posibles desde cero.</span>
          </div></th>
          <td class="item-solo-crafted">${formatGoldColored(totals.totalCrafted)}</td>
        </tr>
      </table>
    </div>
    </div>`;
  let tablaTotalesUnidad = '';
  if (outputCount > 1) {
    tablaTotalesUnidad = `<div class="table-modern-totales">
    <div style='margin-bottom:8px;color:#a1a1aa;font-size:1em;'>Esta receta produce <b>${outputCount}</b> unidades por crafteo. Los siguientes costos son por unidad.</div>
      <div id="totales-crafting">
        <table class="table-totales" style="margin-top:12px;">
          <tr>
            <th><div class="tooltip-modern">Total Compra
              <span class="tooltiptext-modern">Suma total si haces PEDIDO de materiales en el mercado.</span>
            </div></th>
            <td class="item-solo-buy">${formatGoldColored(totals.totalBuy / outputCount)}</td>
            <th><div class="tooltip-modern">Total Venta
              <span class="tooltiptext-modern">Suma total si COMPRAS materiales en el mercado.</span>
            </div></th>
            <td class="item-solo-sell">${formatGoldColored(totals.totalSell / outputCount)}</td>
            <th><div class="tooltip-modern">Total Crafted
              <span class="tooltiptext-modern">Suma total si CRAFTEAS todos los materiales posibles desde cero.</span>
            </div></th>
              <td class="item-solo-crafted">${formatGoldColored(totals.totalCrafted / outputCount)}</td>
          </tr>
        </table>
      </div>
    </div>`;
  }

  let tablaComparativa = '';
  let tablaComparativaUnidad = '';
  let mensajeUnidad = mensaje;
  if (outputCount === 1) {
    tablaComparativa = `<section id='comparativa-section'>
      <div class="table-modern-totales"><br>
        <h3>Comparativa de precios de Bazar vs Crafting</h3>
        <table class='table-totales totales-crafting-comparativa'>
          <tr style='text-align:center;'>
            <td><div style='${minIdx===0 ? 'background:#e84d4d33;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioCompraTotal)} <br><span style='font-size:0.93em;'>Precio compra</span></div></td>
            <td><div style='${minIdx===1 ? 'background:#4db1e833;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioVentaTotal)} <br><span style='font-size:0.93em;'>Precio venta</span></div></td>
            <td><div style='${minIdx===2 ? 'background:#4fc17833;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioCraftingMinTotal)} <br><span style='font-size:0.93em;'>Precio crafting más bajo</span></div></td>
          </tr>
          <tr><td colspan='3' style='text-align:center;font-size:1.07em;'>${mensaje}</td></tr>
        </table>
      </div>
      </section>`;
  }
  if (outputCount > 1) {
    const precioCompraUnidadMercado = (buyPrice != null) ? buyPrice : 0;
    const precioVentaUnidadMercado = (sellPrice != null) ? sellPrice : 0;
    const precioCraftingMinUnidadReal = outputCount > 0 ? precioCraftingMinTotal / outputCount : precioCraftingMinTotal;
    const preciosUnidadCorr = [precioCompraUnidadMercado, precioVentaUnidadMercado, precioCraftingMinUnidadReal];
    const preciosUnidadValidos = preciosUnidadCorr.filter(x => typeof x === 'number' && x > 0);
    const precioMinimoUnidadReal = preciosUnidadValidos.length ? Math.min(...preciosUnidadValidos) : null;
    const minIdxUnidad = precioMinimoUnidadReal != null ? preciosUnidadCorr.indexOf(precioMinimoUnidadReal) : -1;
    mensajeUnidad = 'Sin datos de mercado';
    if (minIdxUnidad === 0) mensajeUnidad = 'Mejor comprar (Buy)';
    else if (minIdxUnidad === 1) mensajeUnidad = 'Mejor vender (Sell)';
    else if (minIdxUnidad === 2) mensajeUnidad = 'Mejor craftear (Crafted)';
    tablaComparativaUnidad = `<section id='comparativa-section-unidad'>
      <div class="table-modern-totales"><br>
        <h3>Comparativa de precios de Bazar vs Crafting por UNIDAD</h3>
        <div style='margin-bottom:8px;color:#a1a1aa;font-size:1em;'>Esta receta produce <b>${outputCount}</b> unidades por crafteo. Los siguientes precios son por unidad.</div>
        <table class='table-totales totales-crafting-comparativa'>
          <tr style='text-align:center;'>
            <td><div style='${minIdxUnidad===0 ? 'background:#e84d4d33;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioCompraUnidadMercado)} <br><span style='font-size:0.93em;'>Precio compra</span></div></td>
            <td><div style='${minIdxUnidad===1 ? 'background:#4db1e833;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioVentaUnidadMercado)} <br><span style='font-size:0.93em;'>Precio venta</span></div></td>
            <td><div style='${minIdxUnidad===2 ? 'background:#4fc17833;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioCraftingMinUnidadReal)} <br><span style='font-size:0.93em;'>Precio crafting más bajo</span></div></td>
          </tr>
          <tr><td colspan='3' style='text-align:center;font-size:1.07em;'>${mensajeUnidad}</td></tr>
        </table>
      </div>
      </section>`;
  }

  const html = `
    <h3>Comparativa de items</h3>

    <table class="table-modern tabla-tarjetas">
      <thead class="header-items table-comparison-row">
        <tr>
          <th class="th-border-left">Ícono</th>
          <th>Nombre</th>
          <th>Cantidad</th>
          <th>Precio de venta</th>
          <th>Total Compra</th>
          <th>Total Venta</th>
          <th>Total Crafted</th>
          <th>Mejor Profit</th>
          <th class="th-border-right"></th>
        </tr>
      </thead>
      <tbody>
        ${window.ingredientObjs.map(ing => `
          ${renderMainItemRow(ing, window.globalQty, ing.total_buy, ing.total_sell, ing.total_crafted)}
          ${window._mainItemExpandedMap[ing.id] ? renderRows(ing.children, 1, ing._uid, 0, true, [ing._uid]) : ''}
`).join('')}
      </tbody>
    </table>
    <!-- ${outputCount > 1 ? tablaTotalesUnidad : tablaTotales} -->
    <!-- Comparativa de precios oculta -->
    ${profitHtml}
  `;

  return html;
}

// --- Renderizado principal refactorizado ---
async function renderItemUI(itemData, marketData) {
  // --- SNAPSHOT DEL ESTADO EXPANDIDO ---
  const expandSnapshot = snapshotExpandState(window.ingredientObjs);
  const itemHeader = document.getElementById('item-header');
  if (itemHeader) {
    itemHeader.style.display = 'none';
    // Si necesitas limpiar el contenido, puedes usar:
    // itemHeader.innerHTML = '';
  }
  // El resto del renderizado continúa normalmente, pero no redeclares la variable.

  // Si necesitas renderizar este header dinámico, usa una variable y asígnalo a innerHTML donde corresponda:
  /*
  const headerHtml = `
    <table class="table-modern tabla-tarjetas" style="margin-bottom:0;"><p>TABLA DINAMICA</p>
      <tbody>
        <tr class="row-bg-a">
          <td class="th-border-left-items" style="width:48px"><img src="${itemData.icon}" width="40" height="40" style="vertical-align:middle;object-fit:contain;border-radius:6px;background:#181c24;box-shadow:0 1px 4px #0008;"></td>
          <td>
            <div style="font-size:1.18em;font-weight:600;">${itemData.name}</div>
            <div style="color:#a1a1aa;font-size:1.05rem;">ID: ${itemData.id} &nbsp;|&nbsp; ${itemData.type}${itemData.rarity ? ' - ' + itemData.rarity : ''}</div>
          </td>
          <td colspan="5" class="th-border-right-items"></td>
        </tr>
      </tbody>
    </table>
  `;
  // document.getElementById('item-header').innerHTML = headerHtml;
  */


  // Precios
  const safeMarketData = marketData || {};
const precios = `
    <!--<table class="table-modern">
      <tr><th><div class="dato-item">Precio de compra</div></th><td><div class="dato-item-info">${formatGoldColored(safeMarketData.buy_price != null ? safeMarketData.buy_price : 0)}</div></td></tr>
      <tr><th><div class="dato-item">Precio de venta</div></th><td><div class="dato-item-info">${formatGoldColored(safeMarketData.sell_price != null ? safeMarketData.sell_price : 0)}</div></td></tr>
       <tr><th><div class="dato-item">Disponibles para comprar</div></th><td><div class="dato-item-info">${safeMarketData.buy_quantity != null ? safeMarketData.buy_quantity : '-'}</div></td></tr> 
       <tr><th><div class="dato-item">Disponibles para vender</div></th><td><div class="dato-item-info">${safeMarketData.sell_quantity != null ? safeMarketData.sell_quantity : '-'}</div></td></tr> 
    </table>-->
  `;
  // Eliminado: seccion-precios, seccion-totales y seccion-comparativa (ya no existen en el HTML)

  // --- RESTAURAR ESTADO EXPANDIDO ANTES DE RENDERIZAR ---
  restoreExpandState(window.ingredientObjs, expandSnapshot);

  // Crafting
  await safeRenderTable(marketData?.buy_price, marketData?.sell_price);

  installUIEvents();
}

// --- Instalación de eventos y render seguro ---
function installUIEvents() {
  // Listener para radios de modo en subingredientes
  // (Ya implementado abajo en el handler global de radios)
}

// Handler global para expandir/collapse ingredientes hijos por data-path
document.addEventListener('click', function(e) {
  if (e.target && e.target.classList.contains('btn-expand')) {
    const pathStr = e.target.getAttribute('data-path');
    if (!pathStr) return;
    const uid = pathStr.split('-').pop();
    const ing = findIngredientByUid(window.ingredientObjs || [], uid);
    if (ing) {
      ing.expanded = !ing.expanded;
      if (typeof safeRenderTable === 'function') safeRenderTable();
    }
  }
});

// Handler radios buy/sell/crafted

  // Handler input cantidad global
  if (!window._qtyGlobalHandlerInstalled) {
    window._qtyGlobalHandlerInstalled = true;
    // INPUT: permite escribir varios dígitos, no fuerza recalculo salvo que sea válido
    document.addEventListener('input', function(e) {
      if (e.target && e.target.id === 'qty-global') {
        window._qtyInputValue = e.target.value;
        // NO recalcula, NO renderiza, NO actualiza globalQty aquí
      }
    });
    // BLUR: si el valor es inválido, lo pone en 1
    document.addEventListener('blur', function(e) {
      if (e.target && e.target.id === 'qty-global') {
        const input = e.target;
        let val = parseInt(input.value, 10);
        if (isNaN(val) || val < 1) {
          setGlobalQty(1);
          window._qtyInputValue = '1';
        } else {
          setGlobalQty(val);
          window._qtyInputValue = input.value;
        }
        if (typeof window._qtyInputValue !== 'undefined' && String(window._qtyInputValue) === String(window.globalQty)) {
          delete window._qtyInputValue;
        }
        safeRenderTable();
      }
    }, true);
    // ENTER: igual que blur
    document.addEventListener('keydown', function(e) {
      if (e.target && e.target.id === 'qty-global' && (e.key === 'Enter')) {
        e.preventDefault();
        const input = e.target;
        let val = parseInt(input.value, 10);
        if (isNaN(val) || val < 1) {
          setGlobalQty(1);
          window._qtyInputValue = '1';
        } else {
          setGlobalQty(val);
          window._qtyInputValue = input.value;
        }
        if (typeof window._qtyInputValue !== 'undefined' && String(window._qtyInputValue) === String(window.globalQty)) {
          delete window._qtyInputValue;
        }
        safeRenderTable();
      }
    });
  }

// --- Inicialización principal ---
export async function initItemUI(itemData, marketData) {
  window._lastItemData = itemData;
  window._lastMarketData = marketData;
  const skeleton = document.getElementById('item-skeleton');
  hideSkeleton(skeleton);
  hideError();
  await renderItemUI(itemData, marketData);
}

  

// --- Inicialización de eventos y render seguro ---

export { renderItemUI, safeRenderTable };

async function safeRenderTable(buyPrice = window._mainBuyPrice, sellPrice = window._mainSellPrice) {
  if (buyPrice == null) buyPrice = window._mainBuyPrice;
  if (sellPrice == null) sellPrice = window._mainSellPrice;
  const usePrecomputed = isFeatureEnabled('usePrecomputed');

  let totals;
  if (usePrecomputed && window.comparativa?.getPrecomputedTotals) {
    totals = window.comparativa.getPrecomputedTotals(window.globalQty);
  } else {
    await recalcAll(window.ingredientObjs, window.globalQty);
    totals = getTotals();
    if (!usePrecomputed) {
      window.comparativa?.clearComparativaMeta?.(null);
    }
  }

  if (!totals) {
    totals = { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
  }

  const seccion = document.getElementById('seccion-crafting');
  if (seccion) {
    const html = renderCraftingSectionUI(totals, buyPrice, sellPrice);
    runIdleTasks([
      () => { seccion.innerHTML = html; },
      () => setQtyInputValue(window.globalQty)
    ]);
  } else {
    setQtyInputValue(window.globalQty);
  }
  if (usePrecomputed && window.comparativa?.updateFreshnessBanner) {
    window.comparativa.updateFreshnessBanner();
  }
}

if (typeof window !== 'undefined') {
window.showSkeleton = showSkeleton;
window.hideSkeleton = hideSkeleton;
  window.showError = showError;
  window.hideError = hideError;
  window.safeRenderTable = safeRenderTable;
  window.renderItemUI = renderItemUI;
  window.installUIEvents = installUIEvents;
}
  // Aquí debe ir la lógica para re-renderizar la tabla de ingredientes y restaurar estados visuales
  // (Implementar usando los helpers y renderRows, etc. según se necesite)


// --- Inicialización principal ---
