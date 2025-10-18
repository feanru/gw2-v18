// Functions aggregated from various utility files

// formatGold and formatGoldColored from dist/js/bundle-utils-1.min.js
// Función robusta para formatear cobre a oro/plata/cobre (soporta negativos y redondeo)
function formatGold(value) {
  const rounded = Math.round(value);
  const isNegative = rounded < 0;
  const absValue = Math.abs(rounded);

  const gold = Math.floor(absValue / 10000);
  const silver = Math.floor((absValue % 10000) / 100);
  const copper = absValue % 100;

  let parts = [];
  if (gold > 0) {
    parts.push(`${gold}g`);
    parts.push(`${silver.toString().padStart(2, '0')}s`);
    parts.push(`${copper.toString().padStart(2, '0')}c`);
  } else if (silver > 0) {
    parts.push(`${silver}s`);
    parts.push(`${copper.toString().padStart(2, '0')}c`);
  } else {
    parts.push(`${copper}c`);
  }

  let result = parts.join(' ');
  if (isNegative) result = '-' + result;
  return result.trim();
}

// Devuelve la misma cantidad pero con etiquetas span de colores
function formatGoldColored(value) {
  const rounded = Math.round(value);
  const isNegative = rounded < 0;
  const absValue = Math.abs(rounded);

  const gold = Math.floor(absValue / 10000);
  const silver = Math.floor((absValue % 10000) / 100);
  const copper = absValue % 100;

  let result = '';
  if (gold > 0) {
    result += `<span class="gold">${gold}<img src="img/Gold_coin.png" alt="Gold" width="12"></span>` +
              `<span class="silver">${silver.toString().padStart(2, '0')}<img src="img/Silver_coin.png" alt="Silver" width="12"></span>` +
              `<span class="copper">${copper.toString().padStart(2, '0')}<img src="img/Copper_coin.png" alt="Copper" width="12"></span>`;
  } else if (silver > 0) {
    result += `<span class="silver">${silver}<img src="img/Silver_coin.png" alt="Silver" width="12"></span> ` +
              `<span class="copper">${copper.toString().padStart(2, '0')}<img src="img/Copper_coin.png" alt="Copper" width="12"></span>`;
  } else {
    result += `<span class="copper">${copper.toString().padStart(2, '0')}<img src="img/Copper_coin.png" alt="Copper" width="12"></span>`;
  }

  if (isNegative) result = '-' + result.trim();
  return result.trim();
}

// rarityClasses object and getRarityClass function from js/rarityUtils.js
const rarityClasses = {
  Basic: 'rarity-basic',
  Fine: 'rarity-fine',
  Masterwork: 'rarity-masterwork',
  Rare: 'rarity-rare',
  Exotic: 'rarity-exotic',
  Ascended: 'rarity-ascended',
  Legendary: 'rarity-legendary'
};

function getRarityClass(rarity) {
  return rarityClasses[rarity] || '';
}

// openSearchModal and closeSearchModal from js/modal-utils.js
(function() {
  window.openSearchModal = async function(
    scriptUrl = new URL('./search-modal.min.js', import.meta.url).href
  ) {
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    modal.style.display = 'block';
    if (!window._searchLoaded && scriptUrl) {
      try {
        await import(scriptUrl);
        window._searchLoaded = true;
      } catch (e) {
        console.error('Error loading search modal', e);
      }
    }
  };

  window.closeSearchModal = function() {
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    modal.style.display = 'none';
  };
})();

// Expose globals
window.formatGold = formatGold;
window.formatGoldColored = formatGoldColored;
window.getRarityClass = getRarityClass;

export { formatGold, formatGoldColored, getRarityClass, rarityClasses };

// Export for Node.js usage if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatGold, formatGoldColored, getRarityClass, rarityClasses };
}
