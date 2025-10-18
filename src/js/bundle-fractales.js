import fetchWithRetry from './utils/fetchWithRetry.js';
import fetchAggregateBundle from './utils/fetchAggregateBundle.js';
// Bundled fractales scripts
// Utilidades compartidas para fractales y forja mística
const iconCache = {};
const rarityCache = {};

async function fetchIconsFor(ids = []) {
  if (!ids.length) return;
  try {
    await fetchAggregateBundle(ids, { iconCache, rarityCache });
    return;
  } catch (err) {
    try {
      const res = await fetchWithRetry(`https://api.guildwars2.com/v2/items?ids=${ids.join(',')}&lang=es`);
      const data = await res.json();
      data.forEach(item => {
        if (item && item.id) {
          iconCache[item.id] = item.icon;
          rarityCache[item.id] = item.rarity;
        }
      });
    } catch {}
  }
}

async function fetchItemPrices(ids = []) {
  if (!ids || ids.length === 0) return new Map();
  try {
    const { priceMap } = await fetchAggregateBundle(ids, { iconCache, rarityCache });
    return priceMap;
  } catch (err) {
    const url = `https://api.datawars2.ie/gw2/v1/items/csv?fields=id,buy_price,sell_price&ids=${ids.join(',')}`;
    try {
      const csv = await fetchWithRetry(url).then(r => r.text());
      const [header, ...rows] = csv.trim().split('\n');
      const headers = header.split(',');
      const idIdx = headers.indexOf('id');
      const buyIdx = headers.indexOf('buy_price');
      const sellIdx = headers.indexOf('sell_price');
      const result = new Map();
      rows.forEach(row => {
        const cols = row.split(',');
        const id = parseInt(cols[idIdx], 10);
        if (!isNaN(id)) {
          result.set(id, {
            buy_price: parseInt(cols[buyIdx], 10) || 0,
            sell_price: parseInt(cols[sellIdx], 10) || 0
          });
        }
      });
      return result;
    } catch (e) {
      return new Map();
    }
  }
}

if (typeof window !== 'undefined') {
  window.FractalesUtils = { fetchIconsFor, fetchItemPrices, iconCache, rarityCache };
}
// --- Lógica de Fractales Gold ---
// IDs de ítems relevantes para fractales (basado en los nombres de la tabla de promedios)
// Puedes agregar/quitar ítems aquí según tus necesidades
// Ingredientes comerciables válidos para fractales, cotejados con dones.js
// Lista exacta y en orden según indicación del usuario
const FRACTALES_ITEMS = [
  { key: 'hueso', id: 24341, nombre: 'Hueso grande' },
  { key: 'veneno', id: 24282, nombre: 'Vesícula de veneno potente' },
  { key: 'polvo', id: 24276, nombre: 'Montón de polvo incandescente' },
  { key: 'totem', id: 24299, nombre: 'Tótem intrincado' },
  { key: 'garra', id: 24350, nombre: 'Garra grande' },
  { key: 'colmillo', id: 24356, nombre: 'Colmillo grande' },
  { key: 'sangre', id: 24294, nombre: 'Vial de sangre potente' },
  { key: 'escama', id: 24288, nombre: 'Escama grande' },
  { key: 'infusion_mas1', id: 49424, nombre: 'Infusión +1' }
];

// Datos de stacks de fractales obtenidos de registros históricos
// Se utilizan para calcular promedios de materiales y oro
const FRACTAL_STACKS = [
  {
    stacks: 55,
    data: {
      oro_de_basura: 59510000,
      garra: 4625.45,
      totem: 4360.23,
      sangre: 5005.12,
      veneno: 4610.56,
      hueso: 4685.78,
      escama: 4750.98,
      colmillo: 4845.01,
      polvo: 4855.34,
      infusion_mas1: 31039.56,
      llaves_encriptacion: 1426.12,
      empíreos: 8445.67
    }
  },
  {
    stacks: 17,
    data: {
      oro_de_basura: 18068500,
      garra: 1340.23,
      totem: 1640.45,
      sangre: 1385.12,
      veneno: 1475.56,
      hueso: 1380.78,
      escama: 1585.98,
      colmillo: 1295.01,
      polvo: 1540.34,
      infusion_mas1: 9799.56,
      llaves_encriptacion: 427.12,
      empíreos: 4125.67
    }
  },
  {
    stacks: 32,
    data: {
      oro_de_basura: 34443500,
      recetas_ascendentes: 65.23,
      infusion_mas1: 18256.56,
      llaves_encriptacion: 783.12,
      hueso: 2685.78,
      veneno: 2775.98,
      polvo: 2665.34,
      totem: 2815.01,
      garra: 2730.45,
      colmillo: 2685.12,
      sangre: 2545.56,
      escama: 2645.98,
      hematites: 8090.12,
      empíreos: 7645.67,
      dragonita: 7645.67,
      sacos_reliquias: 538.12,
      saco_equipamiento: 4.01,
      miniatura: 154
    }
  },
  {
    stacks: 4000,
    data: {
      oro_de_basura: 4283407500,
      recetas_ascendentes: 7555,
      infusion_mas1: 2263678,
      llaves_encriptacion: 99812,
      hueso: 334960,
      veneno: 337195,
      polvo: 337825,
      totem: 338230,
      garra: 339190,
      colmillo: 336540,
      sangre: 339475,
      escama: 339260,
      hematites: 1013835,
      empíreos: 1012619,
      dragonita: 1006125,
      sacos_reliquias: 66795,
      saco_equipamiento: 171,
      miniatura: 19787
    }
  }
];
// Ítems no comerciables o no relevantes para fractales (comentados)
// { key: 'infusion_mas1', id: 49424, nombre: 'Infusión +1' },
// { key: 'empíreos', id: 46735, nombre: 'Fragmento empíreo' },
// { key: 'dragonita', id: 46733, nombre: 'Mineral de dragonita' },
// { key: 'hematites', id: 46731, nombre: 'Montón de polvo de hematites' },
// { key: 'llaves_encriptacion', id: 70438, nombre: 'Clave de encriptación fractal' },
// { key: 'oro_de_basura', id: 0, nombre: 'Oro crudo' },
// { key: 'recetas_asce', id: 0, nombre: 'Recetas ascendidas' },
// { key: 'sacos_reliquias', id: 79792, nombre: 'Puñado de reliquias fractales' },
// { key: 'saco_equipamiento', id: 71510, nombre: 'Saco de equipo excepcional' },
// { key: 'miniatura', id: 74268, nombre: 'Miniatura del profesor Miau' }


// Utilidad para obtener solo los ítems con ID válido de mercado
function getItemsConMercado() {
  return FRACTALES_ITEMS.filter(item => item.id && item.id > 0);
}

// Utilidad para mapear key a nombre
function keyToNombre(key) {
  const item = FRACTALES_ITEMS.find(i => i.key === key);
  return item ? item.nombre : key;
}
if (typeof window !== 'undefined') { window.FractalesLogic = { FRACTALES_ITEMS, FRACTAL_STACKS, getItemsConMercado, keyToNombre }; }
// --- UI dinámico para fractales-gold.html ---
// Variables globales para precios de fractales (se deben actualizar con fetch/cálculo real)
let valorCompra75919 = 0;
let valorVenta75919 = 0;
let valorCompra73248 = 0;
let valorVenta73248 = 0;

function setValoresFractales({ compra75919, venta75919, compra73248, venta73248 }) {
  valorCompra75919 = compra75919;
  valorVenta75919 = venta75919;
  valorCompra73248 = compra73248;
  valorVenta73248 = venta73248;
}

// Cache para iconos y rarezas
// Mapeo simple de key a ID para obtener iconos
const ICON_ID_MAP = {
  garra: 24350,
  totem: 24299,
  sangre: 24294,
  veneno: 24282,
  hueso: 24341,
  escama: 24288,
  colmillo: 24356,
  polvo: 24276,
  infusion_mas1: 49424,
  llaves_encriptacion: 70438,
  empíreos: 46735,
  hematites: 46731,
  dragonita: 46733,
  sacos_reliquias: 79792,
  saco_equipamiento: 71510,
  miniatura: 74268,
  encriptacion_fractal: 75919,
  matriz_estabilizadora: 73248
};


function getIconByKey(key) {
  const id = ICON_ID_MAP[key];
  return id ? iconCache[id] || '' : '';
}

function getRarityByKey(key) {
  const id = ICON_ID_MAP[key];
  return id ? rarityCache[id] || '' : '';
}

let contribucionesChart = null;
let abrirVenderChart = null;
// --- Helper para obtener precios de múltiples ítems en una sola llamada ---

// --- Renderiza la tabla de promedios por stack ---
async function renderTablaPromedios(containerId = 'tabla-promedios') {
  try {
    const sets = FRACTAL_STACKS;
    const claves = [
      { key: 'oro_de_basura', nombre: 'Oro crudo' },
      { key: 'garra', nombre: 'Garra potente' },
      { key: 'totem', nombre: 'Tótem intrincado' },
      { key: 'sangre', nombre: 'Vial de sangre potente' },
      { key: 'veneno', nombre: 'Vesícula de veneno potente' },
    { key: 'hueso', nombre: 'Hueso grande' },
    { key: 'escama', nombre: 'Escama blindada' },
    { key: 'colmillo', nombre: 'Colmillo afilado' },
    { key: 'polvo', nombre: 'Montón de polvo incandescente' },
    { key: 'infusion_mas1', nombre: 'Infusión +1' },
    { key: 'llaves_encriptacion', nombre: 'Clave de encriptación fractal' },
    { key: 'empíreos', nombre: 'Fragmento empíreo' },
    { key: 'recetas_ascendentes', nombre: 'Recetas ascendentes' },
    { key: 'hematites', nombre: 'Montón de polvo de hematites' },
    { key: 'dragonita', nombre: 'Mineral de dragonita' },
    { key: 'sacos_reliquias', nombre: 'Puñado de reliquias fractales' },
    { key: 'saco_equipamiento', nombre: 'Saco de equipo excepcional' },
    { key: 'miniatura', nombre: 'Miniatura del profesor Miau' }
  ];
    const promedios = {};
    claves.forEach(({ key }) => {
      let suma = 0, sumaStacks = 0, apariciones = 0;
      sets.forEach(set => {
        if (set.data[key] !== undefined) {
          suma += set.data[key];
          sumaStacks += set.stacks;
          apariciones++;
        }
      });
      if (apariciones === 1) {
        const set = sets.find(s => s.data[key] !== undefined);
        promedios[key] = set.data[key] / set.stacks;
      } else if (apariciones > 1) {
        promedios[key] = suma / sumaStacks;
      } else {
        promedios[key] = undefined;
      }
    });

    const rows = claves.map(({ key, nombre }) => ({
      id: key,
      nombre,
      icon: getIconByKey(key),
      rarity: getRarityByKey(key),
      promedio: promedios[key]
    }));

    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'table-modern';
    table.innerHTML = `
      <thead>
        <tr>
          <th><div class="dato-item">Recompensa</div></th>
          <th><div class="dato-item">Promedio por stack</div></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    container.appendChild(table);
    const tbody = table.querySelector('tbody');
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', row.id);
      const iconHtml = row.icon ? `<img src="${row.icon}" class="item-icon">` : '';
      const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(row.rarity) : '';
      const value = row.promedio !== undefined ? (row.id === 'oro_de_basura' ? window.formatGoldColored(row.promedio) : row.promedio.toFixed(2)) : '-';
      tr.innerHTML = `
        <td><div class="dato-item">${iconHtml}<span class="${rarityClass}">${row.nombre}</span></div></td>
        <td><div class="dato-item-info">${value}</div></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error en renderTablaPromedios:', err);
  }
}

// --- Renderiza la tabla de precios unitarios de materiales ---
async function renderTablaPrecios(containerId = 'tabla-precios-fractales') {
  try {
    const items = getItemsConMercado();
    let itemsMostrar = [...items];
    if (!itemsMostrar.find(i => i.key === 'infusion_mas1')) {
      const infusion = FRACTALES_ITEMS.find(i => i.key === 'infusion_mas1');
      if (infusion) itemsMostrar.push(infusion);
    }
    // Calcular promedios ponderados por material (igual que en renderTablaPromedios)
    const sets = FRACTAL_STACKS;
    const promedios = {};
    itemsMostrar.forEach(item => {
      let suma = 0, sumaStacks = 0, apariciones = 0;
      sets.forEach(set => {
        if (set.data[item.key] !== undefined) {
          suma += set.data[item.key];
          sumaStacks += set.stacks;
        apariciones++;
      }
    });
    if (apariciones === 1) {
      const set = sets.find(s => s.data[item.key] !== undefined);
      promedios[item.key] = set.data[item.key] / set.stacks;
    } else if (apariciones > 1) {
      promedios[item.key] = suma / sumaStacks;
    } else {
      promedios[item.key] = undefined;
    }
    });
    const priceMap = await fetchItemPrices(itemsMostrar.map(i => i.id));
    const precios = itemsMostrar.map(item => ({
      ...item,
      buy_price: priceMap.get(item.id)?.buy_price || 0,
      sell_price: priceMap.get(item.id)?.sell_price || 0
    }));

    const rows = precios.map(item => ({
      id: item.id,
      key: item.key,
      nombre: keyToNombre(item.key),
      buy_price: item.buy_price,
      sell_price: item.sell_price,
      promedio: promedios[item.key],
      icon: getIconByKey(item.key),
      rarity: rarityCache[item.id]
    }));

    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'table-modern';
    table.innerHTML = `
      <thead>
        <tr>
          <th><div class="dato-item">Material</div></th>
          <th><div class="dato-item">Precio compra</div></th>
          <th><div class="dato-item">Precio venta</div></th>
          <th><div class="dato-item">Total compra (prom)</div></th>
          <th><div class="dato-item">Total venta (prom)</div></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    container.appendChild(table);
    const tbody = table.querySelector('tbody');
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', row.id);
      const totalCompra = row.promedio !== undefined ? window.formatGoldColored(Math.round(row.buy_price * row.promedio)) : '-';
      const totalVenta = row.promedio !== undefined ? window.formatGoldColored(Math.round(row.sell_price * row.promedio)) : '-';
      const iconHtml = row.icon ? `<img src="${row.icon}" class="item-icon">` : '';
      const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(row.rarity) : '';
      tr.innerHTML = `
        <td><div class="dato-item">${iconHtml}<span class="${rarityClass}">${row.nombre}</span></div></td>
        <td><div class="dato-item-info">${window.formatGoldColored(row.buy_price)}</div></td>
        <td><div class="dato-item-info">${window.formatGoldColored(row.sell_price)}</div></td>
        <td><div class="dato-item-info">${totalCompra}</div></td>
        <td><div class="dato-item-info">${totalVenta}</div></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error en renderTablaPrecios:', err);
  }
}

// --- Renderiza la tabla resumen de oro crudo + materiales × 0.85 ---
async function renderTablaResumenOro(containerId = 'tabla-resumen-oro', preciosFractales = {}) {
  try {
    // 1. Promedio de oro crudo
    const sets = FRACTAL_STACKS;
    let suma = 0, sumaStacks = 0;
    sets.forEach(set => {
      if (set.data["oro_de_basura"] !== undefined) {
        suma += set.data["oro_de_basura"];
        sumaStacks += set.stacks;
      }
    });
    const promedioOro = sumaStacks > 0 ? suma / sumaStacks : 0;

  // 2. Precios de materiales comerciables
    const items = getItemsConMercado();
    // Incluye la infusión si no está
    let itemsMostrar = [...items];
    if (!itemsMostrar.find(i => i.key === 'infusion_mas1')) {
      const infusion = FRACTALES_ITEMS.find(i => i.key === 'infusion_mas1');
      if (infusion) itemsMostrar.push(infusion);
    }
    // Fetch precios
    const priceMap = await fetchItemPrices(itemsMostrar.map(i => i.id));
    const precios = itemsMostrar.map(item => ({
      ...item,
      buy_price: priceMap.get(item.id)?.buy_price || 0,
      sell_price: priceMap.get(item.id)?.sell_price || 0
    }));

  // 3. Promedios por material (solo los comerciables)
    const setsPromedios = FRACTAL_STACKS;
    const promedios = {};
    precios.forEach(item => {
      let suma = 0, sumaStacks = 0, apariciones = 0;
      setsPromedios.forEach(set => {
        if (set.data[item.key] !== undefined) {
          suma += set.data[item.key];
          sumaStacks += set.stacks;
          apariciones++;
        }
      });
      if (apariciones === 1) {
        const set = setsPromedios.find(s => s.data[item.key] !== undefined);
        promedios[item.key] = set.data[item.key] / set.stacks;
      } else if (apariciones > 1) {
        promedios[item.key] = suma / sumaStacks;
      } else {
        promedios[item.key] = undefined;
      }
    });

  // 4. Sumar totales de compra/venta
    let totalCompra = 0, totalVenta = 0;
    precios.forEach(item => {
      const promedio = promedios[item.key];
      if (promedio !== undefined) {
        totalCompra += item.buy_price * promedio;
        totalVenta += item.sell_price * promedio;
      }
    });

  // 5. Aplicar 0.85 y sumar oro crudo
    const sumaCompra = promedioOro + (totalCompra * 0.85);
    const sumaVenta = promedioOro + (totalVenta * 0.85);
    const contribuciones = [{ nombre: "Oro crudo", valor: promedioOro }];
    precios.forEach(item => {
      const promedio = promedios[item.key];
      if (promedio !== undefined) {
        contribuciones.push({ nombre: keyToNombre(item.key), valor: item.sell_price * promedio * 0.85 });
      }
    });


  // 7. Render tabla
    const htmlResumen = `
      <table class="table-modern" style="margin-top:12px;">
        <thead>
          <tr>
            <th><div class="dato-item">Resumen</div></th>
          <th><div class="dato-item">Valor total</div></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><div class="dato-item">Oro crudo + (Total compra × 0.85)</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(Math.round(sumaCompra))}</div></td>
        </tr>
        <tr>
          <td><div class="dato-item">Oro crudo + (Total venta × 0.85)</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(Math.round(sumaVenta))}</div></td>
        </tr>
      </tbody>
    </table>
  `;
    if (containerId) {
      const el = document.getElementById(containerId);
      if (el) el.innerHTML = htmlResumen;
    }
    return { sumaCompra, sumaVenta, contribuciones };
  } catch (err) {
    console.error('Error en renderTablaResumenOro:', err);
  }
}

// --- Renderiza la tabla resumen POR ENCRIPTACIÓN (divide valores finales entre 250) ---
async function renderTablaResumenOroIndividual(
  containerId = 'tabla-resumen-oro-individual',
  preciosFractales = {},
  resumenCalculado
) {
  try {
    // Reutilizamos la lógica de renderTablaResumenOro pero dividimos el resultado final entre 250
    let resumen = resumenCalculado;
    if (!resumen) {
      resumen = await renderTablaResumenOro(undefined, preciosFractales);
    }
    if (!resumen) return;
    const divisor = 250;
    const sumaCompraInd = resumen.sumaCompra / divisor;
    const sumaVentaInd = resumen.sumaVenta / divisor;

    const htmlResumenInd = `
      <table class="table-modern" style="margin-top:12px;">
        <thead>
          <tr>
            <th><div class="dato-item">Resumen</div></th>
            <th><div class="dato-item">Valor total</div></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><div class="dato-item">Oro crudo + (Total compra × 0.85) ÷ 250</div></td>
            <td><div class="dato-item-info">${window.formatGoldColored(Math.round(sumaCompraInd))}</div></td>
          </tr>
          <tr>
            <td><div class="dato-item">Oro crudo + (Total venta × 0.85) ÷ 250</div></td>
            <td><div class="dato-item-info">${window.formatGoldColored(Math.round(sumaVentaInd))}</div></td>
          </tr>
        </tbody>
      </table>
    `;
    if (containerId) {
      document.getElementById(containerId).innerHTML = htmlResumenInd;
    }
    return { sumaCompra: sumaCompraInd, sumaVenta: sumaVentaInd };
  } catch (err) {
    console.error('Error en renderTablaResumenOroIndividual:', err);
  }
}


function renderTablaReferenciasProfit(containerId = 'tabla-referencias-profit', preciosFractales = {}, resumen = {}) {
  const {
    compra75919 = 0,
    venta75919 = 0,
    compra73248 = 0,
    venta73248 = 0
  } = preciosFractales;
  const { sumaVenta = 0 } = resumen;
  const costoAbrir = (compra75919 + compra73248) * 250;
  const roi = costoAbrir > 0 ? ((sumaVenta - costoAbrir) / costoAbrir) * 100 : 0;
  const iconEnc = getIconByKey('encriptacion_fractal');
  const iconMat = getIconByKey('matriz_estabilizadora');
  const encIconHtml = iconEnc ? `<img src="${iconEnc}" class="item-icon">` : '';
  const matIconHtml = iconMat ? `<img src="${iconMat}" class="item-icon">` : '';
  const htmlFractales = `
    <table class="table-modern" style="margin-top:0;">
      <thead>
        <tr>
          <th><div class="dato-item">Resumen</div></th>
          <th><div class="dato-item">Valor total</div></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><div class="dato-item">${encIconHtml}Encriptación fractal (compra ×250)</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(compra75919 * 250)}</div></td>
        </tr>
        <tr>
          <td><div class="dato-item">${encIconHtml}Encriptación fractal (venta ×250)</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(venta75919 * 250)}</div></td>
        </tr>
        <tr>
          <td><div class="dato-item">${matIconHtml}Matriz estabilizadora (compra ×250)</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(compra73248 * 250)}</div></td>
        </tr>
        <tr>
          <td><div class="dato-item">${matIconHtml}Matriz estabilizadora (venta ×250)</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(venta73248 * 250)}</div></td>
        </tr>
        <tr>
          <td><div class="dato-item">Suma Encriptación + Matriz (compra) - 15% de comisión</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(((compra75919 + compra73248) * 250) * 0.85)}</div></td>
        </tr>
        <tr>
          <td><div class="dato-item">Suma Encriptación + Matriz (venta) - 15% de comisión</div></td>
          <td><div class="dato-item-info">${window.formatGoldColored(((venta75919 + venta73248) * 250) * 0.85)}</div></td>
        </tr>
        <tr>
          <td><div class="dato-item"><strong>ROI abrir stack</strong></div></td>
          <td><div class="dato-item-info" style="color:${roi>=0 ? 'green' : 'red'};">${roi.toFixed(2)} %</div></td>
        </tr>
      </tbody>
    </table>
  `;
  document.getElementById(containerId).innerHTML = htmlFractales;
}

function renderGraficoContribuciones(contribuciones = [], containerId = 'contribuciones-chart') {
  const ctx = document.getElementById(containerId)?.getContext('2d');
  if (!ctx) return;
  if (contribucionesChart) contribucionesChart.destroy();
  const labels = contribuciones.map(c => c.nombre);
  const data = contribuciones.map(c => c.valor / 10000);
  contribucionesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Oro',
        data,
        backgroundColor: 'rgba(54, 162, 235, 0.6)'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'Oro' } } }
    }
  });
}

function renderGraficoAbrirVsVender(containerId = 'abrir-vs-vender-chart', preciosFractales = {}, resumen = {}) {
  const ctx = document.getElementById(containerId)?.getContext('2d');
  if (!ctx) return;
  if (abrirVenderChart) abrirVenderChart.destroy();

  const {
    venta75919 = 0,
    compra75919 = 0,
    compra73248 = 0
  } = preciosFractales;
  const { sumaVenta = 0 } = resumen;

  const venderStack = venta75919 * 250 * 0.85;
  const abrirConLlaves = sumaVenta;
  const abrirComprandoMatrices = sumaVenta - (compra73248 * 250);
  const abrirComprandoTodo =
    sumaVenta - ((compra73248 + compra75919) * 250);

  abrirVenderChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [
        'Vender stack de encriptación',
        'Abrir con llaves',
        'Abrir comprando matrices',
        'Abrir comprando matrices y encriptaciones'
      ],
      datasets: [{
        label: 'Oro',
        data: [
          venderStack / 10000,
          abrirConLlaves / 10000,
          abrirComprandoMatrices / 10000,
          abrirComprandoTodo / 10000
        ],
        backgroundColor: [
          'rgba(255,99,132,0.6)',
          'rgba(75,192,192,0.6)',
          'rgba(255,205,86,0.6)',
          'rgba(153,102,255,0.6)'
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Oro' } }
      }
    }
  });
}

function renderExtras(preciosFractales = {}, claveStack = 24.96) {
  const { venta73248 = 0 } = preciosFractales;
  const precioMatrizEl = document.getElementById('matriz-precio');
  const conversionEl = document.getElementById('conversion-indirecta');
  if (precioMatrizEl) {
    precioMatrizEl.innerHTML = window.formatGoldColored(venta73248);
  }
  if (conversionEl) {
    const total = Math.round(venta73248 * claveStack);
    conversionEl.innerHTML = window.formatGoldColored(total);
  }
}
if (typeof window !== 'undefined') { window.FractalesGoldUI = { setValoresFractales, ICON_ID_MAP, renderTablaPromedios, renderTablaPrecios, renderTablaResumenOro, renderTablaResumenOroIndividual, renderTablaReferenciasProfit, renderGraficoContribuciones, renderGraficoAbrirVsVender, renderExtras }; }
