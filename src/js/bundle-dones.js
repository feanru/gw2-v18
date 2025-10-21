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
  const loadedTabs = new Set();
  const loadingTabs = new Set();

  const buttons = Array.from(document.querySelectorAll('.tab-button[data-tab]'));
  const contents = Array.from(document.querySelectorAll('.tab-content'));

  const savedTabId = localStorage.getItem('activeDonTab');
  if (savedTabId) {
    const savedButton = buttons.find(btn => btn.getAttribute('data-tab') === savedTabId);
    const savedContent = document.getElementById(savedTabId);
    if (savedButton && savedContent) {
      buttons.forEach(btn => {
        const isActive = btn === savedButton;
        btn.classList.toggle('active', isActive);
      });
      contents.forEach(content => {
        const isActive = content === savedContent;
        content.classList.toggle('active', isActive);
        content.style.display = isActive ? '' : 'none';
      });
    }
  }

  const waitForDonesPages = () => {
    if (window.DonesPages) return Promise.resolve();
    return new Promise(resolve => {
      const listener = () => {
        document.removeEventListener('donespages:ready', listener);
        resolve();
      };
      document.addEventListener('donespages:ready', listener, { once: true });
    });
  };

  const tabsPromise = import('./tabs.min.js');
  const donesPagesReady = waitForDonesPages();
  const ready = Promise.all([tabsPromise, donesPagesReady]);

  const loadHandlers = {
    'tab-don-suerte': () => window.DonesPages?.loadSpecialDons(),
    'tab-tributo-mistico': () => window.DonesPages?.loadTributo(),
    'tab-tributo-draconico': () => window.DonesPages?.loadDraconicTribute(),
    'dones-1ra-gen': () => window.DonesPages?.loadDones1Gen()
  };

  async function handleTab(tabId) {
    if (!tabId) return;
    localStorage.setItem('activeDonTab', tabId);
    if (loadedTabs.has(tabId) || loadingTabs.has(tabId)) return;
    const loader = loadHandlers[tabId];
    if (!loader) return;
    loadingTabs.add(tabId);
    try {
      await ready;
      const loadResult = loader();
      await loadResult;
      loadedTabs.add(tabId);
    } finally {
      loadingTabs.delete(tabId);
    }
  }

  document.addEventListener('tabchange', e => {
    const tabId = e && e.detail ? e.detail.tabId : undefined;
    handleTab(tabId);
  });

  await tabsPromise;

  const activeContent = document.querySelector('.tab-content.active');
  if (activeContent) {
    handleTab(activeContent.id);
  } else if (buttons.length) {
    buttons[0].click();
  }
});
})();
