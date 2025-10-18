import fetchWithRetry from './utils/fetchWithRetry.js';
import fetchAggregateBundle from './utils/fetchAggregateBundle.js';
// Bundled forja mistica scripts
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


function addIconToCell(cell, icon) {
  if (!cell || !icon) return;
  const div = cell.querySelector('div');
  if (!div || div.querySelector('img')) return;
  const img = document.createElement('img');
  img.src = icon;
  img.className = 'item-icon';
  div.prepend(img);
}

const MATERIAL_IDS = {
  t6: {
    sangre: 24295,
    hueso: 24358,
    garra: 24351,
    colmillo: 24357,
    escama: 24289,
    totem: 24300,
    veneno: 24283
  },
  t5: {
    sangre: 24294,
    hueso: 24341,
    garra: 24350,
    colmillo: 24356,
    escama: 24288,
    totem: 24299,
    veneno: 24282
  },
  polvo: 24277,
  piedra: 20796
};

const LODESTONE_IDS = {
  cores: {
    glacial: 24319,
    cristal: 24329,
    destructor: 24324,
    cargado: 24304,
    corrupto: 24339,
    onice: 24309,
    fundido: 24314
  },
  stones: {
    glacial: 24320,
    cristal: 24330,
    destructor: 24325,
    cargado: 24305,
    corrupto: 24340,
    onice: 24310,
    fundido: 24315
  },
  polvo: 24277,
  botella: 19663,
  cristal: 20799
};

const PRICE_OVERRIDES = {
  20796: { price: 0, missing: true }, // Piedra filosofal (requiere fragmentos espirituales)
  19663: { price: 2500, missing: false }, // Botella de vino eloniano
  20799: { price: 0, missing: true } // Cristal (requiere fragmentos espirituales)
};

const SIN_PRECIO_TEXT = 'sin precio';

function resolvePrice(id, priceMap, priceType = 'buy_price') {
  if (Object.prototype.hasOwnProperty.call(PRICE_OVERRIDES, id)) {
    const override = PRICE_OVERRIDES[id];
    if (override && typeof override === 'object') {
      const price = typeof override.price === 'number' ? override.price : null;
      return { price, missing: Boolean(override.missing) || price === null };
    }
    return { price: override, missing: false };
  }

  const priceEntry = priceMap.get(id);
  if (!priceEntry) {
    return { price: null, missing: true };
  }

  const value = priceEntry[priceType];
  if (typeof value === 'number' && value > 0) {
    return { price: value, missing: false };
  }

  return { price: null, missing: true };
}

function sumPrices(components = []) {
  let total = 0;
  let hasNumericPrice = false;

  components.forEach(({ priceInfo, quantity = 1 }) => {
    if (!priceInfo) return;

    const hasPrice = typeof priceInfo.price === 'number' && !Number.isNaN(priceInfo.price);
    if (hasPrice) {
      hasNumericPrice = true;
      total += priceInfo.price * quantity;
    }
  });

  return { value: total, missing: !hasNumericPrice };
}

function computeValue(priceInfo, multiplier = 1) {
  if (!priceInfo) {
    return { value: 0, missing: true };
  }

  const hasPrice = typeof priceInfo.price === 'number' && !Number.isNaN(priceInfo.price);
  const value = hasPrice ? priceInfo.price * multiplier : 0;
  return { value, missing: !hasPrice };
}

function formatValueWithMissing({ value, missing }) {
  const numericValue = typeof value === 'number' ? value : 0;
  const formatted = window.formatGoldColored(numericValue);
  return missing ? `${formatted} <small class="sin-precio">${SIN_PRECIO_TEXT}</small>` : formatted;
}

async function renderTablaForja() {
  const keys = Object.keys(MATERIAL_IDS.t5);
  const ids = [
    ...keys.map(k => MATERIAL_IDS.t5[k]),
    ...keys.map(k => MATERIAL_IDS.t6[k]),
    MATERIAL_IDS.polvo,
    MATERIAL_IDS.piedra
  ];
  const priceMap = await fetchItemPrices(ids);
  await fetchIconsFor(ids);

  keys.forEach(key => {
    const row = document.querySelector(`#matt5t6 tr[data-key="${key}"]`);
    if (!row) return;
    const sumEl = row.querySelector('.sum-mats');
    const resEl = row.querySelector('.resultado');
    const profitEl = row.querySelector('.profit');

    const precioT5 = resolvePrice(MATERIAL_IDS.t5[key], priceMap, 'buy_price');
    const precioT6Buy = resolvePrice(MATERIAL_IDS.t6[key], priceMap, 'buy_price');
    const precioT6Sell = resolvePrice(MATERIAL_IDS.t6[key], priceMap, 'sell_price');
    const precioPolvo = resolvePrice(MATERIAL_IDS.polvo, priceMap, 'buy_price');
    const precioPiedra = resolvePrice(MATERIAL_IDS.piedra, priceMap, 'buy_price');

    const sumMats = sumPrices([
      { priceInfo: precioT5, quantity: 50 },
      { priceInfo: precioPolvo, quantity: 5 },
      { priceInfo: precioPiedra, quantity: 5 },
      { priceInfo: precioT6Buy }
    ]);
    const resultadoBruto = computeValue(precioT6Sell, 6.91);
    const resultadoNeto = { value: resultadoBruto.value * 0.85, missing: resultadoBruto.missing }; // 15% comisión bazar
    const profit = {
      value: resultadoNeto.value - sumMats.value,
      missing: resultadoNeto.missing || sumMats.missing
    };

    if (sumEl) sumEl.innerHTML = formatValueWithMissing(sumMats);
    if (resEl) resEl.innerHTML = formatValueWithMissing(resultadoNeto);
    if (profitEl) profitEl.innerHTML = formatValueWithMissing(profit);

    const cells = row.querySelectorAll('td');
    addIconToCell(cells[0], iconCache[MATERIAL_IDS.t5[key]]);
    addIconToCell(cells[1], iconCache[MATERIAL_IDS.t6[key]]);
    addIconToCell(cells[2], iconCache[MATERIAL_IDS.polvo]);
    addIconToCell(cells[3], iconCache[MATERIAL_IDS.piedra]);
  });
}

async function renderTablaLodestones() {
  const coreKeys = Object.keys(LODESTONE_IDS.cores);
  const ids = [
    ...coreKeys.map(k => LODESTONE_IDS.cores[k]),
    ...coreKeys.map(k => LODESTONE_IDS.stones[k]),
    LODESTONE_IDS.polvo,
    LODESTONE_IDS.botella,
    LODESTONE_IDS.cristal
  ];

  const priceMap = await fetchItemPrices(ids);
  await fetchIconsFor(ids);

  coreKeys.forEach(key => {
    const row = document.querySelector(`#tabla-lodestones tr[data-key="${key}"]`);
    if (!row) return;
    const sumEl = row.querySelector('.sum-mats');
    const profitEl = row.querySelector('.profit');

    const precioCore = resolvePrice(LODESTONE_IDS.cores[key], priceMap, 'buy_price');
    const precioLodestoneSell = resolvePrice(LODESTONE_IDS.stones[key], priceMap, 'sell_price');
    const precioPolvo = resolvePrice(LODESTONE_IDS.polvo, priceMap, 'buy_price');
    const precioBotella = resolvePrice(LODESTONE_IDS.botella, priceMap, 'buy_price');
    const precioCristal = resolvePrice(LODESTONE_IDS.cristal, priceMap, 'buy_price');

    const sumMats = sumPrices([
      { priceInfo: precioCore, quantity: 2 },
      { priceInfo: precioPolvo },
      { priceInfo: precioBotella },
      { priceInfo: precioCristal }
    ]);
    const resultadoNeto = computeValue(precioLodestoneSell, 0.85); // comisión bazar 15%
    const profit = {
      value: resultadoNeto.value - sumMats.value,
      missing: resultadoNeto.missing || sumMats.missing
    };

    if (sumEl) sumEl.innerHTML = formatValueWithMissing(sumMats);
    if (profitEl) profitEl.innerHTML = formatValueWithMissing(profit);

    const cells = row.querySelectorAll('td');
    addIconToCell(cells[0], iconCache[LODESTONE_IDS.cores[key]]);
    addIconToCell(cells[1], iconCache[LODESTONE_IDS.polvo]);
    addIconToCell(cells[2], iconCache[LODESTONE_IDS.botella]);
    addIconToCell(cells[3], iconCache[LODESTONE_IDS.cristal]);
    addIconToCell(cells[4], iconCache[LODESTONE_IDS.stones[key]]);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderTablaForja();
  renderTablaLodestones();
});
