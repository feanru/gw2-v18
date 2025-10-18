import fetchWithRetry from './utils/fetchWithRetry.js';
// Bundled dones core and tabs
(function(){
const API_ITEM = 'https://api.guildwars2.com/v2/items/';
const API_PRICES = 'https://api.guildwars2.com/v2/commerce/prices/';
const itemCache = new Map();
const priceCache = new Map();

const FIXED_PRICE_ITEMS = { 19676: 10000 };

const EXCLUDED_ITEM_IDS = [
  19675, 19925, 20796, 19665, 19674, 19626, 19672, 19673,
  19645, 19650, 19655, 19639, 19635, 19621, 19633, 19634,
  19641, 19642, 19628, 20799 // Cristal místico (no comerciable)
];

const isGiftName = function(name){
  if(!name) return false;
  const lower = name.toLowerCase();
  return lower.startsWith('don de ') || lower.startsWith('don del ') || lower.startsWith('don de la ');
};

const shouldSkipMarketCheck = function(id){
  return EXCLUDED_ITEM_IDS.includes(id);
};

const fetchItemData = async function(id) {
  if (itemCache.has(id)) return itemCache.get(id);
  const stored = sessionStorage.getItem('item:' + id);
  if (stored) {
    const data = JSON.parse(stored);
    itemCache.set(id, data);
    return data;
  }
  const res = await fetchWithRetry(API_ITEM + id);
  if (!res.ok) throw new Error('No se pudo obtener info de item ' + id);
  const json = await res.json();
  itemCache.set(id, json);
  try { sessionStorage.setItem('item:' + id, JSON.stringify(json)); } catch(e) {}
  return json;
};

const fetchPriceData = async function(id) {
  if (FIXED_PRICE_ITEMS[id] !== undefined) {
    const value = FIXED_PRICE_ITEMS[id];
    return {buys:{unit_price:value}, sells:{unit_price:value}};
  }
  if(shouldSkipMarketCheck(id)) return null;
  if (priceCache.has(id)) return priceCache.get(id);
  const stored = sessionStorage.getItem('price:' + id);
  if (stored) {
    const data = JSON.parse(stored);
    priceCache.set(id, data);
    return data;
  }
  const res = await fetchWithRetry(API_PRICES + id);
  if (!res.ok) return null;
  const json = await res.json();
  priceCache.set(id, json);
  try { sessionStorage.setItem('price:' + id, JSON.stringify(json)); } catch(e){}
  return json;
};

if (typeof window !== 'undefined') {
  window.DonesCore = { fetchItemData, fetchPriceData, isGiftName, shouldSkipMarketCheck };
}
// Manejo de pestañas en dones.html
document.addEventListener('DOMContentLoaded', async function() {
  await import('./tabs.min.js');
  const loaded = {};

  function handleTab(tabId) {
    localStorage.setItem('activeDonTab', tabId);
    if (!loaded[tabId] && window.DonesPages) {
      loaded[tabId] = true;
      if (tabId === 'tab-don-suerte') window.DonesPages.loadSpecialDons();
      else if (tabId === 'tab-tributo-mistico') window.DonesPages.loadTributo();
      else if (tabId === 'tab-tributo-draconico') window.DonesPages.loadDraconicTribute();
      else if (tabId === 'dones-1ra-gen') window.DonesPages.loadDones1Gen();
    }
  }

  document.addEventListener('tabchange', e => {
    handleTab(e.detail.tabId);
  });

  const savedTab = localStorage.getItem('activeDonTab');
  const target = savedTab
    ? document.querySelector(`.tab-button[data-tab="${savedTab}"]`)
    : document.querySelector('.tab-button[data-tab]');
  if (target) target.click();
});
})();
