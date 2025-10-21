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
  const loadingTabs = new Map();

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

  const DEFAULT_READY_TIMEOUT = 2000;
  const READY_POLL_INTERVAL = 50;
  let ensureReadyPromise = null;

  const ensureDonesPagesReady = async (timeoutMs = DEFAULT_READY_TIMEOUT) => {
    if (window.DonesPages) return;
    if (ensureReadyPromise) {
      return ensureReadyPromise;
    }

    ensureReadyPromise = new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        if (window.DonesPages) {
          resolve();
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          const error = new Error('DonesPages not ready');
          error.timeoutMs = timeoutMs;
          reject(error);
          return;
        }

        setTimeout(poll, READY_POLL_INTERVAL);
      };

      poll();
    }).finally(() => {
      ensureReadyPromise = null;
    });

    return ensureReadyPromise;
  };

  const TAB_LOADERS = {
    'tab-don-suerte': () => window.DonesPages.loadSpecialDons(),
    'tab-tributo-mistico': () => window.DonesPages.loadTributo(),
    'tab-tributo-draconico': () => window.DonesPages.loadDraconicTribute(),
    'dones-1ra-gen': () => window.DonesPages.loadDones1Gen(),
  };

  const loadTab = async (tabId) => {
    if (!tabId) return;

    localStorage.setItem('activeDonTab', tabId);

    if (loadedTabs.has(tabId)) return;
    if (loadingTabs.has(tabId)) {
      return loadingTabs.get(tabId);
    }

    const loaderPromise = (async () => {
      try {
        await ensureDonesPagesReady();

        const loader = TAB_LOADERS[tabId];
        if (!loader) return;

        await loader();
        loadedTabs.add(tabId);
      } catch (error) {
        console.error('Error loading tab content', tabId, error);
      } finally {
        loadingTabs.delete(tabId);
      }
    })();

    loadingTabs.set(tabId, loaderPromise);
    return loaderPromise;
  };

  const getActiveTabId = () => {
    const active = document.querySelector('.tab-content.active');
    return active ? active.id : null;
  };

  document.addEventListener('tabchange', e => {
    const tabId = e && e.detail ? e.detail.tabId : undefined;
    if (tabId) {
      loadTab(tabId);
    }
  });

  await import('./tabs.min.js');

  let initialTabId = getActiveTabId();
  if (initialTabId) {
    await loadTab(initialTabId);
  } else if (buttons.length) {
    buttons[0].click();
  }
});
})();
