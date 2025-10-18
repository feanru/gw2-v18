// search-modal-core.js
// Funciones base reutilizables para el modal de búsqueda

// Endpoints para obtener la lista de ítems
const API_URL_JSON = 'https://api.datawars2.ie/gw2/v1/items/json?fields=id,name_es';
const API_URL_CSV = 'https://api.datawars2.ie/gw2/v1/items/csv?fields=buy_price,sell_price,buy_quantity,sell_quantity,last_updated,1d_buy_sold,1d_sell_sold,2d_buy_sold,2d_sell_sold,7d_buy_sold,7d_sell_sold,1m_buy_sold,1m_sell_sold';
import { requestItems } from './utils/requestManager.js';
import fetchWithRetry from './utils/fetchWithRetry.js';
import { getItemIconPlaceholderPath } from './utils/iconPlaceholder.js';

const ITEM_ICON_PLACEHOLDER = getItemIconPlaceholderPath();
const PLACEHOLDER_ALT_TEXT = 'Icono no disponible';

function createIconCacheEntry(src, isFallback = false) {
  return {
    src,
    isFallback: Boolean(isFallback),
  };
}

export function normalizeIconCacheEntry(entry) {
  if (!entry) {
    return { src: '', isFallback: false };
  }
  if (typeof entry === 'string') {
    return { src: entry, isFallback: false };
  }
  if (typeof entry === 'object') {
    const candidate = typeof entry.src === 'string' && entry.src
      ? entry.src
      : (typeof entry.url === 'string' ? entry.url : '');
    return {
      src: candidate,
      isFallback: Boolean(entry.isFallback),
    };
  }
  return { src: '', isFallback: false };
}

export function createIconFetcher({
  iconCache = {},
  rarityCache = {},
  requestItemsFn = requestItems,
  logger = console,
} = {}) {
  const log = logger && typeof logger.warn === 'function' ? logger : null;
  return async function fetchIconsFor(ids = []) {
    if (!Array.isArray(ids) || !ids.length) return [];
    let data;
    try {
      data = await requestItemsFn(ids);
    } catch (err) {
      if (log) {
        const message = err && err.message ? err.message : String(err);
        log.warn(`[search-modal] failed to load icons for ids ${ids.join(', ')}: ${message}`);
      }
      return [...ids];
    }
    const missing = [];
    data.forEach((item, index) => {
      const id = ids[index];
      if (item && typeof item.id !== 'undefined') {
        const iconSrc = item && item.icon ? item.icon : ITEM_ICON_PLACEHOLDER;
        const isFallback = !(item && item.icon);
        iconCache[item.id] = createIconCacheEntry(iconSrc, isFallback);
        rarityCache[item.id] = item.rarity;
      } else if (typeof id !== 'undefined') {
        missing.push(id);
      }
    });
    if (missing.length) {
      missing.forEach((id) => {
        if (typeof iconCache[id] === 'undefined') {
          iconCache[id] = createIconCacheEntry(ITEM_ICON_PLACEHOLDER, true);
        }
        if (typeof rarityCache[id] === 'undefined') {
          rarityCache[id] = null;
        }
      });
    }
    if (missing.length && log) {
      log.warn(`[search-modal] icons missing for ids: ${missing.join(', ')}`);
    }
    return missing;
  };
}

export function createResultRenderer({
  resultsEl = null,
  onSelect = function() {},
  iconCache = {},
  rarityCache = {},
  formatPrice = null,
  getRarityClass = null,
} = {}) {
  const rarityFn = typeof getRarityClass === 'function' ? getRarityClass : () => '';

  return function renderResults(items = [], showNoResults = false) {
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
    if (!items.length && showNoResults) {
      resultsEl.innerHTML = '<div class="error-message">No se encontraron ítems.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.onclick = (e) => onSelect(item.id, e);

      const { src, isFallback } = normalizeIconCacheEntry(iconCache[item.id]);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = isFallback ? PLACEHOLDER_ALT_TEXT : '';
        const classes = ['item-icon'];
        if (isFallback) {
          classes.push('item-icon--placeholder');
        }
        img.className = classes.join(' ');
        card.appendChild(img);
      }

      const rarityClass = rarityFn(rarityCache[item.id]);
      const nameEl = document.createElement('div');
      nameEl.className = rarityClass ? `item-name ${rarityClass}` : 'item-name';
      nameEl.textContent = item?.name_es || '';
      card.appendChild(nameEl);

      const buy = formatPrice ? formatPrice(item?.buy_price) : (item?.buy_price || 0);
      const sell = formatPrice ? formatPrice(item?.sell_price) : (item?.sell_price || 0);
      const priceEl = document.createElement('div');
      priceEl.className = 'item-price';
      priceEl.style.display = 'none';
      priceEl.textContent = `Compra: ${buy} | Venta: ${sell}`;
      card.appendChild(priceEl);

      fragment.appendChild(card);
    });

    resultsEl.appendChild(fragment);
  };
}

function initSearchModal(options = {}) {
  const {
    onSelect = function(id) {},
    formatPrice = null,
    useSuggestions = false
  } = options;

  const searchInput = document.getElementById('modal-search-input');
  const suggestionsEl = document.getElementById('modal-suggestions');
    const resultsEl = document.getElementById('modal-results');
    const modalSkeleton = document.getElementById('modal-skeleton');
  const errorMessage = document.getElementById('modal-error-message');

  let allItems = [];
  const iconCache = {};
  const rarityCache = {};

  function normalizeId(value) {
    const numericId = Number(value);
    return Number.isNaN(numericId) ? value : numericId;
  }

  function toggleModalSkeleton(show) {
    if (modalSkeleton) modalSkeleton.classList.toggle('hidden', !show);
  }
  function showError(msg) {
    if (!errorMessage) return;
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
  }
  function hideError() {
    if (errorMessage) errorMessage.style.display = 'none';
  }

  async function fetchAllItems() {
    const cached = sessionStorage.getItem('itemList');
    if (cached) {
      allItems = JSON.parse(cached).map(item => ({
        ...item,
        id: normalizeId(item.id)
      }));
      return;
    }
    hideError();
    try {
      const [resJson, resCsv] = await Promise.all([
        fetchWithRetry(API_URL_JSON),
        fetchWithRetry(API_URL_CSV)
      ]);
      const [itemsJson, csvText] = await Promise.all([
        resJson.json(),
        resCsv.text()
      ]);
      const lines = csvText.trim().split('\n');
      const headers = lines[0].split(',');
      const itemsCsv = lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => {
          if (h === 'last_updated') {
            obj[h] = values[i] || '-';
          } else if (h === 'buy_price' || h === 'sell_price') {
            obj[h] = values[i] !== '' ? parseInt(values[i], 10) : null;
          } else {
            obj[h] = values[i] !== '' ? parseInt(values[i], 10) : null;
          }
        });
        return {
          ...obj,
          id: normalizeId(obj.id)
        };
      });
      const csvById = {};
      itemsCsv.forEach(item => { csvById[normalizeId(item.id)] = item; });
      allItems = itemsJson.map(item => {
        const normalizedId = normalizeId(item.id);
        return {
          ...item,
          id: normalizedId,
          ...(csvById[normalizedId] || {})
        };
      });
      sessionStorage.setItem('itemList', JSON.stringify(allItems));
    } catch (e) {
      showError('No se pudieron cargar los ítems.');
    }
  }

  function renderSuggestions(matches) {
    if (!useSuggestions) {
      if (suggestionsEl) {
        suggestionsEl.innerHTML = '';
        suggestionsEl.style.display = 'none';
      }
      return;
    }
    if (!suggestionsEl) return;
    suggestionsEl.innerHTML = '';
    if (!matches.length) {
      suggestionsEl.style.display = 'none';
      return;
    }
    const frag = document.createDocumentFragment();
    matches.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item.name_es;
      li.onclick = () => onSelect(item.id);
      frag.appendChild(li);
    });
    suggestionsEl.appendChild(frag);
    suggestionsEl.style.display = 'block';
  }

  const getRarityClassFn = typeof getRarityClass === 'function' ? getRarityClass : () => '';

  const renderResults = createResultRenderer({
    resultsEl,
    onSelect,
    iconCache,
    rarityCache,
    formatPrice,
    getRarityClass: getRarityClassFn,
  });

  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  const fetchIconsFor = createIconFetcher({ iconCache, rarityCache, requestItemsFn: requestItems, logger: console });

  function normalizeStr(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  if (searchInput) {
    searchInput.addEventListener('input', debounce(async function() {
      const value = this.value.trim().toLowerCase();
      if (value.length < 3) {
        if (useSuggestions && suggestionsEl) suggestionsEl.style.display = 'none';
        if (resultsEl) resultsEl.innerHTML = '';
        toggleModalSkeleton(false);
        return;
      }
      toggleModalSkeleton(true);
      const normalValue = normalizeStr(value);
      let matches = allItems.filter(item => item.name_es && normalizeStr(item.name_es).includes(normalValue));
      matches = matches.slice(0, 30);
      const missingIcons = matches
        .filter(i => !iconCache[normalizeId(i.id)])
        .map(i => normalizeId(i.id));
      if (missingIcons.length) await fetchIconsFor(missingIcons);
      toggleModalSkeleton(false);
      renderSuggestions(matches);
      renderResults(matches, true);
    }, 250));
  }

  (async function init() {
    toggleModalSkeleton(true);
    await fetchAllItems();
    renderResults([]);
    toggleModalSkeleton(false);
  })();
}

if (typeof window !== 'undefined') {
  window.initSearchModal = initSearchModal;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.initSearchModal = initSearchModal;
  module.exports.createIconFetcher = createIconFetcher;
  module.exports.createResultRenderer = createResultRenderer;
  module.exports.normalizeIconCacheEntry = normalizeIconCacheEntry;
}

