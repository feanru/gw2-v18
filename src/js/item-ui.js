/**
 * GW2 Item Tracker v2 - UI Y PRESENTACIÓN (item-ui.js)
 *
 * getTotals() siempre devuelve los totales globales calculados por recalcAll y no acepta parámetros.
 */

import {
  showSkeleton,
  hideSkeleton,
  showError,
  hideError,
  setQtyInputValue,
  getQtyInputValue
} from './ui-helpers.js';
import { register, update as updateState } from './utils/stateManager.js';
import { initLazyImages, observeSection } from './utils/lazyLoader.js';
import { isFeatureEnabled } from './utils/featureFlags.js';

// Helpers para el input de cantidad global y mensajes de error se
// comparten ahora desde ui-helpers.js

// --- Helpers visuales ---

// La función calcPercent se importa desde item.js
function renderWiki(name, nameEn = null) {
  if (!name) return;
  const wikiLinksEl = document.getElementById('wiki-links');
  if (!wikiLinksEl) return; // Evita errores si no existe el contenedor
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

// --- Helpers de UI ---


// --- Renderizado recursivo de ingredientes ---
export function renderRows(ings, nivel = 1, parentId = null, rowGroupIndex = 0, parentExpanded = true, path = []) {
  // DEPURACIÓN opcional de los radios renderizados
  // ings.forEach((ing, idx) => {
  //   if (nivel > 0) {
  //     console.log('[RENDER RADIO]', { id: ing.id, parentId, modeForParentCrafted: ing.modeForParentCrafted });
  //   }
  // });
  
  return ings.map((ing, idx) => {
    const groupIdx = nivel === 0 ? idx : rowGroupIndex;
    const rowBgClass = groupIdx % 2 === 0 ? 'row-bg-a' : 'row-bg-b';
    const indent = nivel > 0 ? `style="padding-left:${nivel * 30}px"` : '';
    const childClass = `child-of-${ing.id}`;
    const currentPath = [...path, ing._uid].join('-');
    const expandButton = (ing.is_craftable && ing.children && ing.children.length)
      ? `<button class="btn-expand-path" data-path="${currentPath}">${ing.expanded ? '-' : '+'}</button>` : '';
    const isChild = nivel > 0;
    const extraClass = isChild ? `child-of-${parentId}` : '';
    const extraStyle = isChild && !parentExpanded ? 'style="display:none"' : '';
    const noMarketPrice = !ing.buy_price && !ing.sell_price;
    const hasChildren = ing.is_craftable && ing.children && ing.children.length > 0;
    const isLeaf = !hasChildren;
    const showCrafted = nivel === 0 ||
      (hasChildren && (noMarketPrice || ing.total_crafted != null)) ||
      (!hasChildren && ing.total_crafted != null);
    const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(ing.rarity) : '';
    
    return `
      <tr data-state-id="${ing._uid}" data-path="${currentPath}" class="${isChild ? `subrow subrow-${nivel} ${extraClass}` : ''} ${rowBgClass}" ${extraStyle}>
        <td class="th-border-left-items" ${indent}><img data-src="${ing.icon}" width="32" class="lazy-img" alt=""></td>
        <td><a href="/item?id=${ing.id}" class="item-link ${rarityClass}" target="_blank">${ing.name}</a></td>
        <td>${ing.countTotal != null ? ing.countTotal : ing.count}</td>
        <td class="item-solo-buy">
          <div>${formatGoldColored(ing.total_buy)}</div>
          <div class="item-solo-precio">${formatGoldColored(ing.buy_price)} <span style="color: #c99b5b">c/u</span></div>
          ${isChild ? `<input type="radio" name="mode-${ing._uid}" class="chk-mode-buy" data-uid="${ing._uid}" ${ing.modeForParentCrafted === 'buy' ? 'checked' : ''} title="Usar precio de compra para el padre">` : ''}
        </td>
        <td class="item-solo-sell">
          <div>${formatGoldColored(ing.total_sell)}</div>
          <div class="item-solo-precio">${formatGoldColored(ing.sell_price)} <span style="color: #c99b5b">c/u</span></div>
          ${isChild ? `<input type="radio" name="mode-${ing._uid}" class="chk-mode-sell" data-uid="${ing._uid}" ${ing.modeForParentCrafted === 'sell' ? 'checked' : ''} title="Usar precio de venta para el padre">` : ''}
        </td>
        <td class="item-solo-crafted">
          ${
            showCrafted
              ? `<div>${formatGoldColored(ing.total_crafted || 0)}</div>` +
                `<div class="item-solo-precio">${formatGoldColored(0)} <span style="color:#c99b5b">c/u</span></div>` +
                `${isChild ? `<input type="radio" name="mode-${ing._uid}" class="chk-mode-crafted" data-uid="${ing._uid}" ${ing.modeForParentCrafted === 'crafted' ? 'checked' : ''} title="Usar precio de crafteo para el padre">` : ''}`
              : ''
          }
        </td>
        <td class="th-border-right-items">${expandButton}</td>
      </tr>
      ${(ing.is_craftable && ing.children && ing.children.length && parentExpanded && ing.expanded) ? renderRows(ing.children, nivel + 1, ing.id, groupIdx, ing.expanded, [...path, ing._uid]) : ''}
    `;
  }).join('');
}

// --- Renderizado de la fila principal del ítem (nodo raíz) ---
// --- Renderizado SOLO del nodo raíz. Prohibido usar mainNode.total_buy, siempre usar getTotals() ---
// --- Renderizado de la fila principal del ítem (nodo raíz) ---
// --- SOLO del nodo raíz. Totales siempre desde getTotals(), que devuelve los totales globales calculados por recalcAll ---
export function renderMainItemRow(mainNode) {
  if (!mainNode) return '';

  let childTotals = { totalBuy: 0, totalSell: 0 };
  let craftedFallback = 0;
  if (mainNode.children && mainNode.children.length > 0) {
    const totalsFromChildren = getTotals();
    childTotals.totalBuy = totalsFromChildren.totalBuy;
    childTotals.totalSell = totalsFromChildren.totalSell;
    craftedFallback = totalsFromChildren.totalCrafted;
  }
  const totals = {
    totalBuy: childTotals.totalBuy,
    totalSell: childTotals.totalSell,
    totalCrafted: mainNode.total_crafted != null
      ? mainNode.total_crafted
      : craftedFallback
  };
  const buyPriceUnit = mainNode.buy_price || 0;
  const sellPriceUnit = mainNode.sell_price || 0;
  const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(mainNode.rarity) : '';

  // IMPORTANTE: usamos el MISMO selector y data que los hijos
  const expandBtn = `<button class="btn-expand-path" data-path="${mainNode._uid}">${mainNode.expanded ? '-' : '+'}</button>`;

  return `
    <tr data-state-id="${mainNode._uid}" data-path="${mainNode._uid}" data-item-id="${mainNode.id}" class="ingred-row ${mainNode.expanded ? 'expanded' : ''}">
      <!-- Col 1: Ícono (SIN colspan) -->
      <td class="th-border-left-items">
        <img src="${mainNode.icon}" width="32">
      </td>

      <!-- Col 2: Nombre -->
      <td>
        <span class="item-link ${rarityClass}">${mainNode.name}</span>
      </td>

      <!-- Col 3: Cantidad -->
      <td>${mainNode.countTotal != null ? mainNode.countTotal : mainNode.count}</td>

      <!-- Col 4: Total Compra -->
      <td class="item-solo-buy">
        <div>${formatGoldColored(totals.totalBuy)}</div>
        <div class="item-solo-precio">${formatGoldColored(buyPriceUnit)} <span style="color:#c99b5b">c/u</span></div>
      </td>

      <!-- Col 5: Total Venta -->
      <td class="item-solo-sell">
        <div>${formatGoldColored(totals.totalSell)}</div>
        <div class="item-solo-precio">${formatGoldColored(sellPriceUnit)} <span style="color:#c99b5b">c/u</span></div>
      </td>

      <!-- Col 6: Total Crafteo -->
      <td class="item-solo-crafted">
        <div>${formatGoldColored(totals.totalCrafted)}</div>
        <div class="item-solo-precio">${formatGoldColored(0)} <span style="color:#c99b5b">c/u</span></div>
      </td>

      <!-- Col 7: Botón (alineado con hijos) -->
      <td class="th-border-right-items">${expandBtn}</td>
    </tr>
  `;
}



// --- Renderizado de la sección 7: Ingredientes para craftear ---
function renderCraftingSectionUI() {
  const ingList = window.ingredientObjs || [];
  // Los datos deben estar recalculados antes de llamar a esta función

  // Obtener output_item_count de la receta principal
  // Cálculo robusto del outputCount como en la comparativa:
  let outputCount = 1;
  const mainRoot = ingList.length > 0 ? ingList[0] : null;
  if (mainRoot && mainRoot.recipe && mainRoot.recipe.output_item_count && !isNaN(mainRoot.recipe.output_item_count)) {
    outputCount = mainRoot.recipe.output_item_count;
  } else if (window._mainRecipeOutputCount && !isNaN(window._mainRecipeOutputCount)) {
    outputCount = window._mainRecipeOutputCount;
  }

  // --- Totales robustos: getTotals() entrega los totales globales calculados por recalcAll ---
  // --- Buy/Sell se obtienen de esos totales; el crafteo proviene del nodo raíz ---
  let totals = { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
  const globalTotals = getTotals ? getTotals() : null;
  if (globalTotals) {
    if (Number.isFinite(globalTotals.totalBuy)) totals.totalBuy = globalTotals.totalBuy;
    if (Number.isFinite(globalTotals.totalSell)) totals.totalSell = globalTotals.totalSell;
    if (Number.isFinite(globalTotals.totalCrafted)) totals.totalCrafted = globalTotals.totalCrafted;
  }
  let childTotals = null;
  if (mainRoot && mainRoot.children && mainRoot.children.length > 0) {
    childTotals = getTotals();
    totals.totalBuy = childTotals.totalBuy;
    totals.totalSell = childTotals.totalSell;
  }
  if (mainRoot) {
    totals.totalCrafted = mainRoot.total_crafted != null
      ? mainRoot.total_crafted
      : (childTotals ? childTotals.totalCrafted : 0);
  }

  

  const qtyValue = (typeof getQtyInputValue() !== 'undefined' ? getQtyInputValue() : window.globalQty);
  const usePrecomputed = isFeatureEnabled('usePrecomputed');
  if (usePrecomputed) {
    totals.totalBuy *= qtyValue;
    totals.totalSell *= qtyValue;
    totals.totalCrafted *= qtyValue;
  }
  const buyUnit = mainRoot && typeof mainRoot.buy_price === 'number' ? mainRoot.buy_price : (window._mainBuyPrice || 0);
  const sellUnit = mainRoot && typeof mainRoot.sell_price === 'number' ? mainRoot.sell_price : (window._mainSellPrice || 0);
  const precioCompraTotal = buyUnit * qtyValue;
  const precioVentaTotal = sellUnit * qtyValue;
  const precioCraftTotal = totals.totalCrafted;
  const precioCraftingMinTotal = Math.min(totals.totalBuy, totals.totalSell, totals.totalCrafted);
  const precioCraftingMinUnidad = outputCount > 0 ? precioCraftingMinTotal / outputCount : precioCraftingMinTotal;
  const precioCompraUnidad = outputCount > 0 ? totals.totalBuy / outputCount : totals.totalBuy;
  const precioVentaUnidad = outputCount > 0 ? totals.totalSell / outputCount : totals.totalSell;
  const precioCraftUnidad = outputCount > 0 ? totals.totalCrafted / outputCount : totals.totalCrafted;
  const preciosFinales = [precioCompraTotal, precioVentaTotal, precioCraftingMinTotal];
  const preciosFinalesValidos = preciosFinales.filter(x => typeof x === 'number' && x > 0);
  const precioMinimoFinal = preciosFinalesValidos.length ? Math.min(...preciosFinalesValidos) : null;
  const minIdx = precioMinimoFinal != null ? preciosFinales.indexOf(precioMinimoFinal) : -1;
  let mensajeGlobal = 'Sin datos de mercado';
  if (minIdx === 0) mensajeGlobal = 'Mejor comprar (Buy)';
  else if (minIdx === 1) mensajeGlobal = 'Mejor vender (Sell)';
  else if (minIdx === 2) mensajeGlobal = 'Mejor craftear (Crafteo)';

  // --- Renderizar tabla de ingredientes con separación de nodo raíz ---
  // 🔥 Checklist de buenas prácticas de renderizado:
  // 1. El nodo raíz SOLO se renderiza con renderMainItemRow(mainRoot, 0)
  // 2. NUNCA debe pasar por renderRows()
  // 3. Los hijos se renderizan SIEMPRE con renderRows(mainRoot.children, 1)
  // 4. Prohibido: renderRows([mainRoot], 0)
  let htmlTabla = '';
  if (mainRoot) {
  htmlTabla += renderMainItemRow(mainRoot, 0);
  // parentId=null para conservar clases "child-of-null",
  // parentExpanded = !!mainRoot.expanded para mostrar/ocultar por el root,
  // path = [mainRoot._uid] para que los botones hijos construyan bien su ruta
  htmlTabla += renderRows(mainRoot.children, 1, null, 0, !!mainRoot.expanded, [mainRoot._uid]);
}

  // 🚫 Nunca hacer: htmlTabla += renderRows([mainRoot], 0); // Esto mostraría mal los totales del nodo raíz

  // Profit
  let profitHtml = '';
  let profitHtmlUnidad = '';
  if (precioVentaTotal > 0) {
    const ventaTrasComisionTotal = precioVentaTotal - (precioVentaTotal * 0.15);
    const ventaTrasComisionUnidad = outputCount > 0 ? ventaTrasComisionTotal / outputCount : ventaTrasComisionTotal;
    const profitBuyUnidad = ventaTrasComisionUnidad - (totals.totalBuy / outputCount);
    const profitSellUnidad = ventaTrasComisionUnidad - (totals.totalSell / outputCount);
    const profitCraftedUnidad = ventaTrasComisionUnidad - (totals.totalCrafted / outputCount);
    const profitBuyTotal = ventaTrasComisionTotal - totals.totalBuy;
    const profitSellTotal = ventaTrasComisionTotal - totals.totalSell;
    const profitCraftedTotal = ventaTrasComisionTotal - totals.totalCrafted;
    if (outputCount === 1) {
      profitHtml = `<section id='profit-section'><br>
        <div class="table-modern-totales">
        <div class="titulo-con-ayuda">
          <div class="ayuda-tooltip">?
            <span class="tooltiptext-modern"> Esta sección muestra la ganancia estimada al vender el ítem después de craftearlo. Se calcula como: (Precio venta - 15% comisión) - costo total de crafteo. También muestra 3 posibles resultados dependiendo de la forma de craftear.</span>
          </div>
          <h3>Profit si se craftea y se vende (ganancia estimada)</h3>
        </div>
        <table class='table-totales totales-crafting-comparativa' style='margin-bottom: 8px;'>
          <tr style='text-align:center;'>
            <td><div class='base-comparativa'>${formatGoldColored(Math.round(profitBuyTotal))} <br><span style='font-size:0.93em;'>Profit "Comprar"</span></div></td>
            <td><div class='base-comparativa'>${formatGoldColored(Math.round(profitSellTotal))} <br><span style='font-size:0.93em;'>Profit "Vender"</span></div></td>
            <td><div class='base-comparativa'>${formatGoldColored(Math.round(profitCraftedTotal))} <br><span style='font-size:0.93em;'>Profit "Craftear"</span></div></td>
          </tr>
          <tr><td colspan='3' style='text-align:center;font-size:0.98em;color:#a1a1aa;'>La ganancia se calcula como: (Precio venta - 15% comisión) - costo total</td></tr>
        </table>
      </div>
      </section>`;
    }
    if (outputCount > 1) {
      const precioVentaUnidadMercado = (_mainSellPrice != null) ? _mainSellPrice : 0;
      const ventaTrasComisionUnidadMercado = precioVentaUnidadMercado - (precioVentaUnidadMercado * 0.15);
      const profitBuyUnidadMercado = ventaTrasComisionUnidadMercado - (totals.totalBuy / outputCount);
      const profitSellUnidadMercado = ventaTrasComisionUnidadMercado - (totals.totalSell / outputCount);
      const profitCraftedUnidadMercado = ventaTrasComisionUnidadMercado - (totals.totalCrafted / outputCount);
      profitHtmlUnidad = `<section id='profit-section-unidad'><br>
        <div class="table-modern-totales">          
        <h3>Profit si se craftea y se vende por UNIDAD (ganancia estimada)</h3>
        <div style='margin-bottom:8px;color:#a1a1aa;font-size:1em;'>Esta receta produce <b>${outputCount}</b> unidades por crafteo. Los siguientes cálculos son por unidad.</div>
        <table class='table-totales totales-crafting-comparativa' style='margin-bottom: 8px;'>
          <tr style='text-align:center;'>
            <td><div class='base-comparativa'>${formatGoldColored(Math.round(profitBuyUnidadMercado))} <br><span style='font-size:0.93em;'>Profit "Comprar"</span></div></td>
            <td><div class='base-comparativa'>${formatGoldColored(Math.round(profitSellUnidadMercado))} <br><span style='font-size:0.93em;'>Profit "Vender"</span></div></td>
            <td><div class='base-comparativa'>${formatGoldColored(Math.round(profitCraftedUnidadMercado))} <br><span style='font-size:0.93em;'>Profit "Craftear"</span></div></td>
          </tr>
          <tr><td colspan='3' style='text-align:center;font-size:0.98em;color:#a1a1aa;'>La ganancia por unidad se calcula como: (Precio venta unitario - 15% comisión) - costo unitario</td></tr>
        </table>
      </div>
      </section>`;
    }
  }

  // --- Insertar tabla de ingredientes en el HTML ---
  let tablaIngredientes = `<table class="table-crafting" id="tabla-crafting">
    <thead class="header-items">
      <tr>
        <th class="th-border-left-items"></th>
        <th>Nombre</th>
        <th>Cantidad</th>
        <th>Total Compra</th>
        <th>Total Venta</th>
        <th>Total Crafteo</th>
        <th class="th-border-right-items"></th>
      </tr>
    </thead>
    <tbody>
      ${htmlTabla}
    </tbody>
  </table>`;

  // Tablas de totales
  // Input SIEMPRE antes de la tabla de ingredientes
  let inputQtyHtml = `<div id="qty-global-container" style="margin:18px 0 18px 0;display:flex;align-items:center;gap:12px;">
    <label for="qty-global" style="font-weight:500;">Cantidad global:</label>
    <input id="qty-global" type="number" min="1" value="${qtyValue}" style="width:60px;height:36px;" autocomplete="off">
  </div>`;
  let tablaTotales = `<div class="table-modern-totales">
    <div class="titulo-con-ayuda">
      <div class="ayuda-tooltip">?
        <span class="tooltiptext-modern">Esta sección muestra el costo total de los materiales necesarios para craftear el ítem. Con costo de materiales en venta directa, pedido y crafteo de sus propio materiales.</span>
      </div>
      <h3>Precio total materiales - Crafting</h3>
    </div>
    <div id="totales-crafting">      
      <table class="table-totales" style="margin-top:12px;">
        <tr>
          <th><div class="tooltip-modern">Total Compra
            <span class="tooltiptext-modern">Suma total si haces PEDIDO de materiales en el mercado.</span>
          </div></th>
          <td class="item-solo-buy">${formatGoldColored(totals.totalBuy)} </td>
          <th><div class="tooltip-modern">Total Venta
            <span class="tooltiptext-modern">Suma total si COMPRAS materiales en el mercado.</span>
          </div></th>
          <td class="item-solo-sell">${formatGoldColored(totals.totalSell)}</td>
          <th><div class="tooltip-modern">Total Crafteo
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
    <div class="titulo-con-ayuda">
      <div class="ayuda-tooltip">?
        <span class="tooltiptext-modern">Muestra el costo por unidad ya que esta receta produce múltiples ítems</span>
      </div>
      <h3>Costos por unidad (${outputCount} unidades por crafteo)</h3>
    </div>
    <div style='margin-bottom:8px;color:#a1a1aa;font-size:1em;'>Esta receta produce <b>${outputCount}</b> unidades por crafteo.</div>
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
            <th><div class="tooltip-modern">Total Crafteo
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
  let mensajeUnidad = mensajeGlobal;
  // Generar tabla comparativa antes del return
  if (outputCount === 1) {
    tablaComparativa = `<section id='comparativa-section'>
      <div class="table-modern-totales">
        <div class="titulo-con-ayuda">
          <div class="ayuda-tooltip">?
            <span class="tooltiptext-modern"> Esta sección compara el precio de compra directa y pedido en el mercado con el costo de crafteo más bajo.</span>
          </div>
          <h3>Comparativa de precios de Bazar vs Crafting</h3>
        </div>
        <br>
        <table class='table-totales totales-crafting-comparativa'>
          <tr style='text-align:center;'>
            <td><div class='base-comparativa' style='${minIdx===0 ? 'background:#e84d4d33;' : ''}'>${formatGoldColored(precioCompraTotal)} <br><span style='font-size:0.93em;'>Precio compra</span></div></td>
            <td><div class='base-comparativa' style='${minIdx===1 ? 'background:#4db1e833;' : ''}'>${formatGoldColored(precioVentaTotal)} <br><span style='font-size:0.93em;'>Precio venta</span></div></td>
            <td><div class='base-comparativa' style='${minIdx===2 ? 'background:#4fc17833;' : ''}'>${formatGoldColored(precioCraftingMinTotal)} <br><span style='font-size:0.93em;'>Precio crafting más bajo</span></div></td>
          </tr>
          <tr><td colspan='3' style='text-align:center;font-size:1.07em;'>${mensajeGlobal}</td></tr>
        </table>
      </div>
      </section>`;
  }
  if (outputCount > 1) {
    const globalQty = window.globalQty || 1;
    const precioCompraUnidadMercado = (_mainBuyPrice != null) ? _mainBuyPrice * globalQty : 0;
    const precioVentaUnidadMercado = (_mainSellPrice != null) ? _mainSellPrice * globalQty : 0;
    const precioCraftingMinUnidadReal = outputCount > 0 ? precioCraftingMinTotal / outputCount : precioCraftingMinTotal;
    const preciosUnidadCorr = [precioCompraUnidadMercado, precioVentaUnidadMercado, precioCraftingMinUnidadReal];
    const preciosUnidadValidos = preciosUnidadCorr.filter(x => typeof x === 'number' && x > 0);
    const precioMinimoUnidadReal = preciosUnidadValidos.length ? Math.min(...preciosUnidadValidos) : null;
    const minIdxUnidadReal = precioMinimoUnidadReal != null ? preciosUnidadCorr.indexOf(precioMinimoUnidadReal) : -1;
    mensajeUnidad = 'Sin datos de mercado';
    if (minIdxUnidadReal === 0) mensajeUnidad = 'Mejor comprar (Buy)';
    else if (minIdxUnidadReal === 1) mensajeUnidad = 'Mejor vender (Sell)';
    else if (minIdxUnidadReal === 2) mensajeUnidad = 'Mejor craftear (Crafteo)';
    tablaComparativaUnidad = `<section id='comparativa-section-unidad'>
      <div class=\"table-modern-totales\"><br>
        <h3>Comparativa de precios de Bazar vs Crafting por UNIDAD</h3>
        <div style='margin-bottom:8px;color:#a1a1aa;font-size:1em;'>Esta receta produce <b>${outputCount}</b> unidades por crafteo. Los siguientes precios son por unidad.</div>
        <table class='table-totales totales-crafting-comparativa'>
          <tr style='text-align:center;'>
            <td><div style='${minIdxUnidadReal===0 ? 'background:#e84d4d33;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioCompraUnidadMercado)} <br><span style='font-size:0.93em;'>Precio compra</span></div></td>
            <td><div style='${minIdxUnidadReal===1 ? 'background:#4db1e833;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioVentaUnidadMercado)} <br><span style='font-size:0.93em;'>Precio venta</span></div></td>
            <td><div style='${minIdxUnidadReal===2 ? 'background:#4fc17833;font-weight:bold;border-radius:6px;padding:10px;' : ''}'>${formatGoldColored(precioCraftingMinUnidadReal)} <br><span style='font-size:0.93em;'>Precio crafting más bajo</span></div></td>
          </tr>
          <tr><td colspan='3' style='text-align:center;font-size:1.07em;'>${mensajeUnidad}</td></tr>
        </table>
      </div>
      </section>`;
  }

  // HTML FINAL
  let htmlFinal = `
    ${inputQtyHtml}
    <table class="table-modern tabla-tarjetas">
      <thead class="header-items">
        <tr>
          <th class="th-border-left">Ícono</th>
          <th>Nombre</th>
          <th>Cantidad</th>
          <th>Total Compra</th>
          <th>Total Venta</th>
          <th>Total Crafteo</th>
          <th class="th-border-right"></th>
        </tr>
      </thead>
      <!-- 👇 Aquí va la tabla correcta: root + hijos -->
      <tbody>${htmlTabla}</tbody>
    </table>
    ${tablaTotales}
    ${outputCount > 1 ? tablaTotalesUnidad : ''}
    ${tablaComparativa}
    ${outputCount > 1 ? tablaComparativaUnidad : ''}
    ${profitHtml}
    ${outputCount > 1 ? profitHtmlUnidad : ''}
  `;
  return htmlFinal;
}

// --- Renderizado principal refactorizado ---
async function renderItemUI(itemData, marketData) {
  // console.log('%cLEGACY renderItemUI ejecutado', 'color: #f44336; font-weight: bold;', itemData);

  const itemHeader = document.getElementById('item-header');
  // Verificar si hay información de artesanía
  let craftingInfo = '';
  if (itemData.details?.disciplines?.length > 0 || itemData.details?.min_rating > 0) {
    const disciplineNames = {
      'Artificer': 'Artesano',
      'Armorsmith': 'Armero',
      'Chef': 'Cocinero',
      'Huntsman': 'Cazador',
      'Jeweler': 'Joyero',
      'Leatherworker': 'Peletero',
      'Tailor': 'Sastre',
      'Weaponsmith': 'Armero de armas',
      'Scribe': 'Escriba'
    };

    const translatedDisciplines = (itemData.details.disciplines || [])
      .map(d => disciplineNames[d] || d);

    craftingInfo = `
      <div style="margin-top: 4px; color: #a1a1aa; font-size: 0.95rem;">
        ${itemData.details.min_rating ? `<span style="color: #16c198; font-weight: 500;">Nivel:</span> ${itemData.details.min_rating} ` : ''}
        ${translatedDisciplines.length > 0 ? 
          `<span style="color: #16c198; font-weight: 500;">${itemData.details.min_rating ? '• ' : ''}Disciplinas:</span> ${translatedDisciplines.join(', ')}` : ''}
      </div>
    `;
  }

  const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(itemData.rarity) : '';
  itemHeader.innerHTML = `
    <img src="${itemData.icon}" alt=""/>
    <div>
      <h2 class="${rarityClass}">${itemData.name}</h2>
      <div style="color:#a1a1aa;font-size:1.05rem;">
        ID: ${itemData.id} &nbsp;|&nbsp; ${itemData.type} ${itemData.rarity ? ' - ' + itemData.rarity : ''}
      </div>
      ${craftingInfo}
    </div>
  `;

  // Precios
  const precios = `
    <table class="table-modern">
      <tr>
        <th><div class="dato-item tooltip-modern">Precio de compra
          <span class="tooltiptext-modern">Precio al que los compradores están dispuestos a adquirir el ítem (mejor oferta de compra).</span>
        </div></th>
        <td><div class="dato-item-info">${formatGoldColored(marketData.buy_price)}</div></td>
      </tr>
      <tr>
        <th><div class="dato-item tooltip-modern">Precio de venta
          <span class="tooltiptext-modern">Precio al que los vendedores ofrecen el ítem (mejor oferta de venta).</span>
        </div></th>
        <td><div class="dato-item-info">${formatGoldColored(marketData.sell_price)}</div></td>
      </tr>
      <tr>
        <th><div class="dato-item tooltip-modern">Disponibles para vender
          <span class="tooltiptext-modern">Cantidad total de ítems listados actualmente para vender en el mercado.</span>
        </div></th>
        <td><div class="dato-item-info">${marketData.sell_quantity ?? '-'}</div></td>
      </tr>
      <tr>
        <th><div class="dato-item tooltip-modern">Disponibles para comprar
          <span class="tooltiptext-modern">Cantidad total de ítems que los compradores buscan adquirir en el mercado.</span>
        </div></th>
        <td><div class="dato-item-info">${marketData.buy_quantity ?? '-'}</div></td>
      </tr>
    </table>
  `;
  // --- Renderizar resumen de mercado SOLO en #resumen-mercado ---
  const resumenMercadoDiv = document.getElementById('resumen-mercado');

  if (resumenMercadoDiv) {
    const skeletonMarket = document.createElement('div');
    skeletonMarket.classList.add('skeleton', 'skeleton-market-summary');
    resumenMercadoDiv.appendChild(skeletonMarket);

    observeSection(resumenMercadoDiv, () => {
      hideSkeleton(skeletonMarket);
      resumenMercadoDiv.insertAdjacentHTML('beforeend', renderResumenMercado(marketData));
    });
  }

  // --- Renderizar SOLO crafting en #info-item ---
  const infoItemDiv = document.getElementById('info-item');

  if (infoItemDiv) {
    // 🔥 Recalcular todos los ingredientes ANTES de renderizar la UI
    if (window.ingredientObjs && window.ingredientObjs.length > 0) {
      await recalcAll(window.ingredientObjs, window.globalQty);
    }
    infoItemDiv.innerHTML = `
      <div id=\"seccion-totales\"></div>
      <div id=\"seccion-comparativa\"></div>
      <div id=\"seccion-crafting\"></div>
    `;
    document.getElementById('seccion-totales').innerHTML = '';
    document.getElementById('seccion-comparativa').innerHTML = '';
    document.getElementById('seccion-crafting').innerHTML = renderCraftingSectionUI();
    document.querySelectorAll('#seccion-crafting tr[data-state-id]').forEach(row => {
      const id = row.getAttribute('data-state-id');
      register(id, row, (ing) => {
        const buyCell = row.querySelector('.item-solo-buy');
        if (buyCell) buyCell.innerHTML = `<div>${formatGoldColored(ing.total_buy)}</div><div class="item-solo-precio">${formatGoldColored(ing.buy_price)} <span style="color: #c99b5b">c/u</span></div>`;
        const sellCell = row.querySelector('.item-solo-sell');
        if (sellCell) sellCell.innerHTML = `<div>${formatGoldColored(ing.total_sell)}</div><div class="item-solo-precio">${formatGoldColored(ing.sell_price)} <span style="color: #c99b5b">c/u</span></div>`;
        const craftedCell = row.querySelector('.item-solo-crafted');
        if (craftedCell) craftedCell.innerHTML =
          `<div>${formatGoldColored(ing.total_crafted || 0)}</div>` +
          `<div class="item-solo-precio">${formatGoldColored(0)} <span style="color:#c99b5b">c/u</span></div>`;
      });
    });
    requestAnimationFrame(() => {
      initLazyImages();
      setTimeout(initLazyImages, 0); // salvaguarda
    });
  }



  renderWiki(itemData.name, itemData.name_en);
  installUIEvents();
}

// --- Instalación de eventos y render seguro ---
function installUIEvents() {
  // Evitar doble instalación
  if (window._uiEventsInstalled) return;
  window._uiEventsInstalled = true;
  
  // console.log('[INIT] installUIEvents llamada');
  
  // Handler input cantidad global - LÓGICA IDÉNTICA A compare-ui.js
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
        e.preventDefault(); // Evita salto de línea o submit
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

  // Manejador centralizado para los radios de modo
  document.addEventListener('change', async function(e) {
    const input = e.target;
    if (!input.matches('.chk-mode-buy, .chk-mode-sell, .chk-mode-crafted')) return;
  
    const uid = input.dataset.uid;
    if (!uid) return;
    const ing = findIngredientByUid(window.ingredientObjs || [], uid);
    if (!ing) return;
  
    if (input.classList.contains('chk-mode-buy')) {
      ing.modeForParentCrafted = 'buy';
    } else if (input.classList.contains('chk-mode-sell')) {
      ing.modeForParentCrafted = 'sell';
    } else if (input.classList.contains('chk-mode-crafted')) {
      ing.modeForParentCrafted = 'crafted';
    }

    await safeRenderTable();
  });

  // Handler global para expandir/colapsar ingredientes hijos por data-path
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.btn-expand-path');
    if (!btn) return;
    const pathStr = btn.getAttribute('data-path');
    if (!pathStr) return;
    const path = pathStr.split('-').map(x => x.trim());
    const ing = findIngredientByPath(window.ingredientObjs || [], path);
    if (ing) {
      ing.expanded = !ing.expanded;
      if (typeof safeRenderTable === 'function') safeRenderTable();
    }
  });
}




// --- Inicialización de eventos y render seguro ---
async function safeRenderTable() {
  // Siempre recalcula y renderiza la sección de ingredientes y totales.
  const usePrecomputed = isFeatureEnabled('usePrecomputed');
  if (!usePrecomputed && typeof recalcAll === 'function') {
    await recalcAll(window.ingredientObjs || [], window.globalQty);
  }

  const seccion = document.getElementById('seccion-crafting');
  if (seccion) {
    // Guardar el valor actual del input y el estado de los expandibles
    const qtyInput = document.getElementById('qty-global');
    const currentQty = qtyInput ? qtyInput.value : window.globalQty;
    const expandedStates = snapshotExpandState(window.ingredientObjs || []);

    // Renderizar de nuevo toda la sección
    seccion.innerHTML = renderCraftingSectionUI();
    document.querySelectorAll('#seccion-crafting tr[data-state-id]').forEach(row => {
      const id = row.getAttribute('data-state-id');
      register(id, row, (ing) => {
        const buyCell = row.querySelector('.item-solo-buy');
        if (buyCell) {
          const buyTotal = buyCell.querySelector('div:first-child');
          const buyUnit = buyCell.querySelector('.item-solo-precio');
          if (buyTotal) buyTotal.innerHTML = formatGoldColored(ing.total_buy);
          if (buyUnit) buyUnit.innerHTML = `${formatGoldColored(ing.buy_price)} <span style="color: #c99b5b">c/u</span>`;
        }
        const sellCell = row.querySelector('.item-solo-sell');
        if (sellCell) {
          const sellTotal = sellCell.querySelector('div:first-child');
          const sellUnit = sellCell.querySelector('.item-solo-precio');
          if (sellTotal) sellTotal.innerHTML = formatGoldColored(ing.total_sell);
          if (sellUnit) sellUnit.innerHTML = `${formatGoldColored(ing.sell_price)} <span style="color: #c99b5b">c/u</span>`;
        }
        const craftedCell = row.querySelector('.item-solo-crafted');
        if (craftedCell) {
          const craftedTotal = craftedCell.querySelector('div:first-child');
          const craftedUnit = craftedCell.querySelector('.item-solo-precio');
          if (craftedTotal) craftedTotal.innerHTML = formatGoldColored(ing.total_crafted || 0);
          if (craftedUnit) craftedUnit.innerHTML = `${formatGoldColored(0)} <span style="color:#c99b5b">c/u</span>`;
        }
      });
    });

    // Registrar nodos de totales para actualizaciones incrementales
    document.querySelectorAll('#totales-crafting').forEach(totEl => {
      const isUnit = totEl.closest('.table-modern-totales')
        ?.querySelector('h3')
        ?.textContent?.includes('unidad');
      const stateId = isUnit ? 'totales-crafting-unit' : 'totales-crafting-global';
      register(stateId, totEl, (totals) => {
        const divisor = isUnit
          ? (window._mainRecipeOutputCount && !isNaN(window._mainRecipeOutputCount)
            ? window._mainRecipeOutputCount
            : 1)
          : 1;
        const buyCell = totEl.querySelector('.item-solo-buy');
        if (buyCell) buyCell.innerHTML = formatGoldColored(totals.totalBuy / divisor);
        const sellCell = totEl.querySelector('.item-solo-sell');
        if (sellCell) sellCell.innerHTML = formatGoldColored(totals.totalSell / divisor);
        const craftedCell = totEl.querySelector('.item-solo-crafted');
        if (craftedCell) craftedCell.innerHTML = formatGoldColored(totals.totalCrafted / divisor);
      });
    });
    const totals = getTotals();
    updateState('totales-crafting-global', totals);
    updateState('totales-crafting-unit', totals);

    // Restaurar el valor del input y el estado de los expandibles
    const newQtyInput = document.getElementById('qty-global');
    if (newQtyInput) {
      newQtyInput.value = currentQty;
    }
    restoreExpandState(window.ingredientObjs || [], expandedStates);
    requestAnimationFrame(() => {
      initLazyImages();
      setTimeout(initLazyImages, 0); // salvaguarda
    });
  }
}
window.safeRenderTable = safeRenderTable;
  // Re-sincronizar el input de cantidad global
  setTimeout(() => {
    setQtyInputValue(window.globalQty);
    const input = document.getElementById('qty-global');

    if (input) {
      // Debug opcional sobre cambios en el input
      // input.addEventListener('input', (e) => {
      //   console.log('[DEBUG] input qty-global changed:', e.target.value);
      // });
      // input.addEventListener('change', (e) => {
      //   console.log('[DEBUG] change qty-global:', e.target.value);
      // });
    }
  }, 0);

  // --- FIX: Instalar listeners de expand/collapse tras renderizar ---
  setTimeout(() => {
    if (typeof installUIEvents === 'function') {
      installUIEvents();

    } else {
      console.warn('[ADVERTENCIA] installUIEvents no está definido');
    }
  }, 0);

// --- Inicialización principal ---
// --- Exportaciones ---
async function initItemUI(itemData, marketData) {
  window._lastItemData = itemData;
  window._lastMarketData = marketData;
  const skeleton = document.getElementById('item-skeleton');
  hideError();
  try {
    await renderItemUI(itemData, marketData);
  } finally {
    hideSkeleton(skeleton);
  }
}

window.showSkeleton = showSkeleton;
window.hideSkeleton = hideSkeleton;
window.showError = showError;
window.hideError = hideError;
window.renderItemUI = renderItemUI;
window.installUIEvents = installUIEvents;
window.initItemUI = initItemUI;

function renderResumenMercado(marketData) {
  return `
      <table class="table-modern">
        <tr>
          <th><div class="dato-item tooltip-modern">Precio de compra
            <span class="tooltiptext-modern">Precio al que los compradores están dispuestos a adquirir el ítem (mejor oferta de compra).</span>
          </div></th>
          <td><div class="dato-item-info">${formatGoldColored(marketData.buy_price)}</div></td>
        </tr>
        <tr>
          <th><div class="dato-item tooltip-modern">Precio de venta
            <span class="tooltiptext-modern">Precio al que los vendedores ofrecen el ítem (mejor oferta de venta).</span>
          </div></th>
          <td><div class="dato-item-info">${formatGoldColored(marketData.sell_price)}</div></td>
        </tr>
        <tr>
          <th><div class="dato-item tooltip-modern">Disponibles para vender
            <span class="tooltiptext-modern">Cantidad total de ítems listados actualmente para vender en el mercado.</span>
          </div></th>
          <td><div class="dato-item-info">${marketData.sell_quantity ?? '-'}</div></td>
        </tr>
        <tr>
          <th><div class="dato-item tooltip-modern">Disponibles para comprar
            <span class="tooltiptext-modern">Cantidad total de ítems que los compradores buscan adquirir en el mercado.</span>
          </div></th>
          <td><div class="dato-item-info">${marketData.buy_quantity ?? '-'}</div></td>
        </tr>
      </table>
      <section id="ventas-compras" class="bloque-section">
        <h3>Ventas y Compras Recientes</h3>
        <table class="table-modern">
          <tr><th></th><th style="text-align:center;">1 día</th><th style="text-align:center;">2 días</th><th style="text-align:center;">7 días</th><th style="text-align:center;">1 mes</th></tr>
          <tr>
            <th><div class="dato-item tooltip-modern">Ventas
                <span class="tooltiptext-modern">Cantidad de ítems comprados directamente en el periodo (actividad de salida del mercado).</span>
                </div>
            </th>
            <td><div class="dato-item-info">${marketData['1d_sell_sold'] ?? '-'}</div></td>
            <td><div class="dato-item-info">${marketData['2d_sell_sold'] ?? '-'}</div></td>
            <td><div class="dato-item-info">${marketData['7d_sell_sold'] ?? '-'}</div></td>
            <td><div class="dato-item-info">${marketData['1m_sell_sold'] ?? '-'}</div></td>
          </tr>
          <tr>
            <th><div class="dato-item tooltip-modern">Compras
                <span class="tooltiptext-modern">Cantidad de ítems vendidos directamente en el periodo (actividad de entrada al mercado).</span>
                </div></th>
            <td><div class="dato-item-info">${marketData['1d_buy_sold'] ?? '-'}</div></td>
            <td><div class="dato-item-info">${marketData['2d_buy_sold'] ?? '-'}</div></td>
            <td><div class="dato-item-info">${marketData['7d_buy_sold'] ?? '-'}</div></td>
            <td><div class="dato-item-info">${marketData['1m_buy_sold'] ?? '-'}</div></td>
          </tr>
          <tr><td colspan="5" style="color:#888;font-size:0.95em;">* Basado en actividad reciente.</td></tr>
        </table>
      </section>
      <section id="porcentajes-rotacion" class="bloque-section">
        <h3>Porcentajes de Rotación</h3>
        <table class="table-modern">
          <tr><th></th><th style="text-align:center;">1 día</th><th style="text-align:center;">2 días</th><th style="text-align:center;">7 días</th><th style="text-align:center;">1 mes</th></tr>
          <tr>
            <th><div class="dato-item tooltip-modern">Ventas/Supply
                <span class="tooltiptext-modern">Porcentaje de ítems comprados directamente respecto al total disponible (rotación de inventario en el mercado).</span>
                </div></th>
            <td><div class="dato-item-info">${calcPercent(marketData['1d_sell_sold'], marketData.sell_quantity)}</div></td>
            <td><div class="dato-item-info">${calcPercent(marketData['2d_sell_sold'], marketData.sell_quantity)}</div></td>
            <td><div class="dato-item-info">${calcPercent(marketData['7d_sell_sold'], marketData.sell_quantity)}</div></td>
            <td><div class="dato-item-info">${calcPercent(marketData['1m_sell_sold'], marketData.sell_quantity)}</div></td>
          </tr>
          <tr>
            <th><div class="dato-item tooltip-modern">Compras/Demand
                <span class="tooltiptext-modern">Porcentaje de ítems vendidos directamente respecto a la demanda total (flujo de entrada al mercado).</span>
                </div></th>
            <td><div class="dato-item-info">${calcPercent(marketData['1d_buy_sold'], marketData.buy_quantity)}</div></td>
            <td><div class="dato-item-info">${calcPercent(marketData['2d_buy_sold'], marketData.buy_quantity)}</div></td>
            <td><div class="dato-item-info">${calcPercent(marketData['7d_buy_sold'], marketData.buy_quantity)}</div></td>
            <td><div class="dato-item-info">${calcPercent(marketData['1m_buy_sold'], marketData.buy_quantity)}</div></td>
          </tr>
          <tr><td colspan="5" style="color:#888;font-size:0.95em;">* Basado en actividad reciente comparada con la cantidad disponible.</td></tr>
        </table>
      </section>
  `;
}
