// Bundled legendary crafting scripts
import { getCached, setCached, fetchDedup } from './utils/cache.js';
import { getPrice, clearCache as clearPriceCache } from './utils/priceHelper.js';
import { fetchItemAggregate } from './services/aggregateService.mjs';
import { toUiModel } from './adapters/aggregateAdapter.js';
import { runCostsWorkerTask } from './workers/costsWorkerClient.js';
/**
 * Servicio para interactuar con la API de Guild Wars 2
 */
const LEGENDARY_AGG_FIELDS = ['item', 'totals', 'market'];

class GuildWars2API {
  constructor() {
    this.BASE_URL = 'https://api.guildwars2.com/v2';
    this.ITEMS_ENDPOINT = `${this.BASE_URL}/items`;
    this.PRICES_ENDPOINT = `${this.BASE_URL}/commerce/prices`;
    this.RECIPES_ENDPOINT = `${this.BASE_URL}/recipes/search`;
    this.ITEMS_BULK_ENDPOINT = `${this.BASE_URL}/items?ids=`;

    // Configuración de caché
    this.CACHE_PREFIX = 'gw2_api_cache_';
    this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas en milisegundos
  }

  _normalizeItemData(itemId, item) {
    if (!item) {
      return null;
    }
    const normalized = { ...item };
    if (normalized.icon) {
      if (!normalized.icon.startsWith('http')) {
        const cleanPath = normalized.icon
          .replace(/^file\//, '')
          .replace(/^\//, '');
        normalized.icon = `https://render.guildwars2.com/file/${cleanPath}`;
      }
    } else {
      console.warn(`[getItemDetails] El ítem ${itemId} no tiene icono definido`);
      normalized.icon = `https://render.guildwars2.com/file/${itemId}.png`;
    }
    return normalized;
  }

  _normalizeAggregateMarket(itemId, market) {
    if (!market || typeof market !== 'object') {
      return null;
    }
    const toNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const buy = [
      market.unitBuyPrice,
      market.unit_buy_price,
      market.buy_price,
      market.buyPrice,
      market.buy,
      market.total_buy,
      market?.buys?.unit_price,
    ].map(toNumber).find((value) => value != null);
    const sell = [
      market.unitSellPrice,
      market.unit_sell_price,
      market.sell_price,
      market.sellPrice,
      market.sell,
      market.total_sell,
      market?.sells?.unit_price,
    ].map(toNumber).find((value) => value != null);
    if (buy == null && sell == null) {
      return null;
    }
    return {
      id: Number(itemId) || itemId,
      buys: { unit_price: buy ?? 0 },
      sells: { unit_price: sell ?? 0 },
    };
  }

  async _fetchAggregate(itemId, fields = LEGENDARY_AGG_FIELDS) {
    const numericId = Number(itemId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return null;
    }
    try {
      const raw = await fetchItemAggregate(numericId, { fields });
      return toUiModel(raw);
    } catch (error) {
      console.warn(`[GuildWars2API] No se pudo obtener el agregado para el ítem ${itemId}`, error);
      return null;
    }
  }

  /**
   * Realiza una petición a la API con manejo de caché
   */
  async _fetchWithCache(url, useCache = true) {
    const cacheKey = this.CACHE_PREFIX + btoa(url);
    if (useCache) {
      const cached = getCached(cacheKey);
      if (cached) return cached;
    }
    try {
      const response = await fetchDedup(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Clone the response to parse the body without consuming the original
      const cloned = response.clone();
      const data = await cloned.json();

      if (useCache) {
        setCached(cacheKey, data, this.CACHE_DURATION);
      }
      return data;
    } catch (error) {
      console.error('Error en la petición a la API:', error);
      throw error;
    }
  }

  /**
   * Obtiene los precios de un ítem
   */
  async getItemPrices(itemId) {
    const aggregate = await this._fetchAggregate(itemId, LEGENDARY_AGG_FIELDS);
    if (aggregate?.market) {
      const normalized = this._normalizeAggregateMarket(itemId, aggregate.market);
      if (normalized) {
        return normalized;
      }
    }

    const url = `${this.PRICES_ENDPOINT}/${itemId}`;
    return this._fetchWithCache(url);
  }

  /**
   * Obtiene los detalles de un ítem
   */
  async getItemDetails(itemId) {
    const url = `${this.ITEMS_ENDPOINT}/${itemId}?lang=es`;
    const cacheKey = this.CACHE_PREFIX + btoa(url);
    const cached = getCached(cacheKey);
    if (cached) {
      return cached;
    }

    const aggregate = await this._fetchAggregate(itemId, LEGENDARY_AGG_FIELDS);
    if (aggregate?.item) {
      const normalized = this._normalizeItemData(itemId, aggregate.item);
      if (normalized) {
        setCached(cacheKey, normalized, this.CACHE_DURATION);
        return normalized;
      }
    }

    try {
      const item = await this._fetchWithCache(url, false);
      if (!item) {
        console.warn(`[getItemDetails] No se encontró el ítem con ID: ${itemId}`);
        return null;
      }
      const normalized = this._normalizeItemData(itemId, item);
      if (normalized) {
        setCached(cacheKey, normalized, this.CACHE_DURATION);
        return normalized;
      }
      return item;
    } catch (error) {
      console.error(`[getItemDetails] Error al obtener detalles del ítem ${itemId}:`, error);
      return {
        id: itemId,
        name: `Item ${itemId}`,
        icon: 'https://render.guildwars2.com/file/0120CB0368B7953F0D3BD2A0C9100BCF0839FF4D/219035.png',
        error: error.message
      };
    }
  }

  /**
   * Obtiene múltiples ítems por sus IDs
   */
  async getItemsBulk(itemIds) {
    if (!itemIds || !itemIds.length) return [];
    const idsParam = itemIds.join(',');
    const url = `${this.ITEMS_BULK_ENDPOINT}${idsParam}`;
    return this._fetchWithCache(url);
  }

  /**
   * Busca recetas que usan un ítem específico
   */
  async findRecipesForItem(itemId) {
    const url = `${this.RECIPES_ENDPOINT}?output=${itemId}`;
    const recipeIds = await this._fetchWithCache(url);
    
    if (!recipeIds || !recipeIds.length) return [];
    
    // Obtener detalles de las recetas
    const recipesUrl = `${this.BASE_URL}/recipes?ids=${recipeIds.join(',')}`;
    return this._fetchWithCache(recipesUrl);
  }

  /**
   * Limpia la caché de la API
   */
  clearCache() {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(this.CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
      return true;
    } catch (e) {
      console.error('Error al limpiar la caché:', e);
      return false;
    }
  }
}

const gw2API = new GuildWars2API();
/**
 * Clase que representa un ingrediente en el árbol de crafteo
 */
class Ingredient {
  constructor(id, name, type, rarity = null, count = 1, parent = null) {
    this.id = id;
    this.name = name;
    this.type = type || 'crafting_material';
    this.rarity = rarity;
    this.count = count;
    this.parent = parent;
    this.components = [];
    this.icon = null;
    this.source = null;
    this._buyPrice = 0;
    this._sellPrice = 0;
    this._priceLoaded = false;
    
      // Generamos la URL del icono basada en el ID si no hay un icono definido
    // Esto se hace en el getter en lugar del constructor para asegurar que siempre tengamos la última versión
    Object.defineProperty(this, 'icon', {
      get() {
        return this._icon || this._generateIconUrl();
      },
      set(value) {
        this._icon = value;
      },
      enumerable: true,
      configurable: true
    });
  }
  
  /**
   * Genera una URL de icono basada en el ID del ítem
   * @returns {Promise<string>} URL del icono o URL por defecto si hay error
   */
  async _generateIconUrl() {
    // Si ya tenemos un ícono en caché, lo retornamos
    if (this._icon) {
      if (this._icon.startsWith('http')) return this._icon;
      return `https://render.guildwars2.com/file/${this._icon}`;
    }

    // Si no hay ID, retornamos el ícono por defecto
    if (!this.id) {
      return this._getDefaultIconUrl();
    }

    try {
      // Obtener los detalles del ítem utilizando el servicio con caché
      const itemData = await gw2API.getItemDetails(this.id);

      if (itemData && itemData.icon) {
        this._icon = itemData.icon;
        return this._formatIconUrl(this._icon);
      }

      return this._getDefaultIconUrl();
    } catch (error) {
      console.warn('No se pudo cargar el icono para el ítem', this.id, error);
      return this._getDefaultIconUrl();
    }
  }
  
  /**
   * Obtiene la URL del icono por defecto
   * @returns {string} URL del icono por defecto
   */
  _getDefaultIconUrl() {
    return 'https://render.guildwars2.com/file/0120CB0368B7953F0D3BD2A0C9100BCF0839FF4D/219035.png';
  }
  
  /**
   * Formatea una URL de icono, asegurando que sea una URL completa
   * @param {string} iconPath - Ruta o URL del icono
   * @returns {string} URL completa del icono
   */
  _formatIconUrl(iconPath) {
    if (!iconPath) return null;
    
    // Si ya es una URL completa
    if (iconPath.startsWith('http')) {
      return iconPath;
    }
    
    // Si comienza con 'file/', lo eliminamos para evitar duplicados
    const cleanPath = iconPath.startsWith('file/') 
      ? iconPath.substring(5) 
      : iconPath;
    
    // Aseguramos que no tenga una barra al inicio
    const normalizedPath = cleanPath.startsWith('/') 
      ? cleanPath.substring(1) 
      : cleanPath;
    
    return `https://render.guildwars2.com/file/${normalizedPath}`;
  }

  /**
   * Agrega un componente hijo
   */
  addComponent(component) {
    if (component) {
      this.components.push(component);
      component.parent = this;
    }
  }



  /**
   * Obtiene el precio de compra del ítem
   * @returns {number} Precio de compra en cobre
   */
  get buyPrice() {
    return this._buyPrice || 0;
  }

  /**
   * Obtiene el precio de venta del ítem
   * @returns {number} Precio de venta en cobre
   */
  get sellPrice() {
    return this._sellPrice || 0;
  }

  /**
   * Establece los precios del ítem
   * @param {number} buyPrice - Precio de compra en cobre
   * @param {number} sellPrice - Precio de venta en cobre
   */
  setPrices(buyPrice, sellPrice) {
    this._buyPrice = buyPrice || 0;
    this._sellPrice = sellPrice || 0;
    this._priceLoaded = true;
  }

  /**
   * Verifica si el precio ya fue cargado
   * @returns {boolean} true si el precio ya fue cargado
   */
  isPriceLoaded() {
    return this._priceLoaded;
  }

  /**
   * Obtiene el precio total de compra (precio unitario * cantidad)
   * @returns {number} Precio total de compra en cobre
   */
  getTotalBuyPrice() {
    return this.buyPrice * this.count;
  }

  /**
   * Obtiene el precio total de venta (precio unitario * cantidad)
   * @returns {number} Precio total de venta en cobre
   */
  getTotalSellPrice() {
    return this.sellPrice * this.count;
  }

  /**
   * Calcula los totales de forma recursiva para este ingrediente y sus componentes
   * @returns {Object} Objeto con los totales de compra y venta
   */
  calculateTotals(multiplier = 1) {
    const effective = multiplier * this.count;

    // Si no tiene componentes, devolvemos los precios directos
    if (!this.components || this.components.length === 0) {
      return {
        buy: this.buyPrice * effective,
        sell: this.sellPrice * effective,
        isCraftable: false
      };
    }

    // Manejo especial para Trébol místico (ID 19675)
    if (this.id === 19675) {
      let totalBuy = 0;
      let totalSell = 0;
      let todosTienenPrecio = true;

      let counts = null;
      if (this.count === 77) {
        counts = [250, 250, 250, 1500].map(c => c * multiplier);
      } else if (this.count === 38) {
        counts = this.components.map(() => 38 * multiplier);
      }

      if (counts) {
        this.components.forEach((componente, idx) => {
          const originalCount = componente.count;
          componente.count = counts[idx] || 0;
          const totalesComponente = componente.calculateTotals(1);
          componente.count = originalCount;
          totalBuy += totalesComponente.buy;
          totalSell += totalesComponente.sell;
          if (totalesComponente.buy <= 0 && totalesComponente.sell <= 0) {
            todosTienenPrecio = false;
          }
        });
        return { buy: totalBuy, sell: totalSell, isCraftable: todosTienenPrecio };
      }
    }

    // Si tiene componentes, calculamos los totales recursivamente
    let totalBuy = 0;
    let totalSell = 0;
    let todosTienenPrecio = true;

    for (const componente of this.components) {
      const totalesComponente = componente.calculateTotals(effective);

      // Sumar los precios de los componentes, considerando la cantidad
      totalBuy += totalesComponente.buy;
      totalSell += totalesComponente.sell;

      // Si algún componente no tiene precio, marcamos como no crafteable
      if (totalesComponente.buy <= 0 && totalesComponente.sell <= 0) {
        todosTienenPrecio = false;
      }
    }

    // Si todos los componentes tienen precio, actualizamos este ítem
    if (todosTienenPrecio && totalBuy > 0 && !this._priceLoaded) {
      this._buyPrice = totalBuy / effective;
      this._sellPrice = totalSell / effective;
      this._priceLoaded = true;
    }

    return {
      buy: this.buyPrice * effective,
      sell: this.sellPrice * effective,
      isCraftable: todosTienenPrecio
    };
  }

  /**
   * Convierte el ingrediente a un objeto plano para serialización
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      rarity: this.rarity,
      count: this.count,
      buyPrice: this._buyPrice,
      sellPrice: this._sellPrice,
      icon: this.icon,
      source: this.source,
      components: this.components.map(c => c.toJSON())
    };
  }
}

/**
 * Crea un árbol de ingredientes a partir de los datos de un ítem
 */
async function createIngredientTree1(itemData, parent = null) {
  if (!itemData) return null;

  const apiDetails = await gw2API.getItemDetails(itemData.id);

  // Crear el ingrediente con los datos básicos
  const ingredient = new Ingredient(
    itemData.id,
    itemData.name,
    itemData.type,
    apiDetails?.rarity || itemData.rarity || null,
    itemData.count || 1,
    parent
  );

  // Copiar propiedades adicionales
  if (itemData.icon) {
    // Si el icono ya es una URL completa, lo usamos directamente
    if (itemData.icon.startsWith('http') || itemData.icon.startsWith('//')) {
      ingredient.icon = itemData.icon;
    } 
    // Si es una ruta relativa, la convertimos a URL completa
    else {
      // Aseguramos que no tenga el prefijo 'file/' duplicado
      const cleanIconPath = itemData.icon.startsWith('file/') 
        ? itemData.icon.substring(5) 
        : itemData.icon;
      
      ingredient.icon = `https://render.guildwars2.com/file/${cleanIconPath}`;
    }
  }
  
  if (itemData.source) ingredient.source = itemData.source;

  // Lista de IDs que no deben buscar precios en el mercado
  // Se excluyen materiales de cuenta, no comerciables o con precios especiales
  const EXCLUDED_ITEM_IDS = [
    // Materiales de cuenta o con precios especiales
    20799,  // Esquirla de hematites (vinculado a la cuenta)
    20797,  // Otra variante de Esquirla de hematites
    19675,  // Trébol místico (vinculado a la cuenta)
    19925,  // Esquirla de obsidiana (precio especial)
    20796,  // Piedra filosofal (precio especial)
    
    // Materiales de tercera generación que no son comerciables
    97829,  // Bendición de la Emperatriz de Jade
    96137,  // Tributo dracónico
    45178,  // Esencia de la suerte exótica
    73137,  // Cubo de energía oscura estabilizada
    71994,  // Bola de energía oscura
    95813,  // Reactivo hidrocatalítico
    79418   // Piedra rúnica mística
  ];

  // Función para verificar si un ítem debe ser excluido de la búsqueda de precios
  const shouldSkipMarketCheck = (id, name) => {
    // Verificar por ID
    if (EXCLUDED_ITEM_IDS.includes(id)) {
      return true;
    }
    
    // Verificar por nombre (solo para ítems que no son comerciables)
    if (name) {
      const lowerName = name.toLowerCase();
      return lowerName.includes('bendición') ||
             lowerName.includes('tributo') ||
             lowerName.includes('esencia de la suerte') ||
             lowerName.startsWith('don de') ||
             lowerName.endsWith('gift');
    }
    
    return false;
  };

  // Cargar precios para materiales básicos que no estén en la lista de exclusión
  if (ingredient.id === 19676) {
    // Precio fijo para 'Piedra rúnica helada': 1g (10000 cobre)
    ingredient.setPrices(10000, 10000);
  } else if (isBasicMaterial(ingredient.id) && !shouldSkipMarketCheck(ingredient.id, ingredient.name)) {
      try {
        const prices = await getPrice(ingredient.id);
        if (prices) {
          ingredient.setPrices(prices.buy_price || 0, prices.sell_price || 0);
        } else {
          console.warn(`Precios no disponibles para ${ingredient.name} (${ingredient.id})`);
          ingredient.setPrices(0, 0);
        }
      } catch (error) {
      // Si la API devuelve un error (por ejemplo, 404), asumimos que no hay precios
      console.warn(`Error al cargar precios para ${ingredient.name} (${ingredient.id}):`, error.message);
      ingredient.setPrices(0, 0);
    }
  }

  // Procesar componentes hijos si existen
  if (itemData.components && Array.isArray(itemData.components)) {
    const results = await Promise.allSettled(
      itemData.components.map(componentData => createIngredientTree1(componentData, ingredient))
    );
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        ingredient.addComponent(r.value);
      }
    });
    return ingredient;
  }

  return ingredient;
}

// Adaptador para convertir un objeto Ingredient al formato {id, qty, children}
function adaptIngredientForWorker(ing) {
  return {
    id: ing.id,
    qty: ing.count,
    buy_price: ing.buyPrice > 0 ? ing.buyPrice : null,
    sell_price: ing.sellPrice > 0 ? ing.sellPrice : null,
    is_craftable: Array.isArray(ing.components) && ing.components.length > 0,
    children: Array.isArray(ing.components) ? ing.components.map(adaptIngredientForWorker) : []
  };
}

// Convierte la propiedad qty en count para el worker
function _mapQtyToCount(node) {
  node.count = node.qty;
  delete node.qty;
  if (Array.isArray(node.children)) {
    node.children.forEach(_mapQtyToCount);
  }
}

// Aplica los datos calculados por el worker al árbol original
function applyWorkerData(src, dest) {
  dest.total_buy = src.total_buy;
  dest.total_sell = src.total_sell;
  dest.total_crafted = src.total_crafted;
  dest.crafted_price = src.crafted_price;
  if (src.children && dest.components) {
    for (let i = 0; i < src.children.length && i < dest.components.length; i++) {
      applyWorkerData(src.children[i], dest.components[i]);
    }
  }
}

async function runCostsWorker(tree, globalQty = 1) {
  const result = await runCostsWorkerTask({ ingredientTree: tree, globalQty });
  return result || { updatedTree: null, totals: null };
}

// Importamos la API para usarla en esta función
// Importamos las utilidades necesarias


/**
 * Crea un árbol de ingredientes a partir de los datos de un ítem
 */
async function createIngredientTree3(itemData, parent = null) {
  if (!itemData) return null;

  const apiDetails = await gw2API.getItemDetails(itemData.id);

  // Crear el ingrediente con los datos básicos
  const ingredient = new Ingredient(
    itemData.id,
    itemData.name,
    itemData.type,
    apiDetails?.rarity || itemData.rarity || null,
    itemData.count || 1,
    parent
  );

  // Copiar propiedades adicionales
  if (itemData.icon) {
    // Si el icono ya es una URL completa, lo usamos directamente
    if (itemData.icon.startsWith('http') || itemData.icon.startsWith('//')) {
      ingredient.icon = itemData.icon;
    } 
    // Si es una ruta relativa, la convertimos a URL completa
    else {
      // Aseguramos que no tenga el prefijo 'file/' duplicado
      const cleanIconPath = itemData.icon.startsWith('file/') 
        ? itemData.icon.substring(5) 
        : itemData.icon;
      
      ingredient.icon = `https://render.guildwars2.com/file/${cleanIconPath}`;
    }
  }
  
  if (itemData.source) ingredient.source = itemData.source;

  // Lista de IDs que no deben buscar precios en el mercado
  const EXCLUDED_ITEM_IDS = [
    // Tercera generación
    97829,  // Bendición de la Emperatriz de Jade
    96137,  // Tributo dracónico
    20799,  // Esquirla de hematites
    19925,  // Esquirla de obsidiana
    20796,  // Cristal místico
    45178,  // Esencia de la suerte exótica
    73137,  // Cubo de energía oscura estabilizada
    71994,  // Bola de energía oscura
    95813,  // Reactivo hidrocatalítico
    79418,  // Piedra rúnica mística
    19675,  // Trébol místico
    
    // Materiales de Deldrimor
    45845,  // Filo para hacha de acero de Deldrimor
    45846,  // Filo para daga de acero de Deldrimor
    45852,  // Cabeza para maza de acero de Deldrimor
    45833,  // Cañón para pistola de acero de Deldrimor
    45885,  // Núcleo para cetro de madera espiritual
    45848,  // Filo para espada de acero de Deldrimor
    45884,  // Núcleo para foco de madera espiritual
    45858,  // Umbo para escudo de acero de Deldrimor
    45838,  // Cabezal para antorcha de acero de Deldrimor
    45839,  // Cuerno de acero de Deldrimor
    45847,  // Filo para mandoble de acero de Deldrimor
    45851,  // Cabeza para martillo de acero de Deldrimor
    45841,  // Duela para arco largo de madera espiritual
    45834,  // Cañón para rifle de acero de Deldrimor
    45842,  // Duela para arco corto de madera espiritual
    45887,  // Cabezal para báculo de madera espiritual
    
    // Poemas
    97160,  // Poema sobre hachas
    96187,  // Poema sobre dagas
    96035,  // Poema sobre mazas
    95809,  // Poema sobre pistolas
    96173,  // Poema sobre cetros
    97335,  // Poema sobre espadas
    96951,  // Poema sobre focos
    95740,  // Poema sobre escudos
    97257,  // Poema sobre antorchas
    96341,  // Poema sobre cuernos de guerra
    96036,  // Poema sobre mandobles
    97082,  // Poema sobre martillos
    97800,  // Poema sobre arcos largos
    97201,  // Poema sobre rifles
    96849,  // Poema sobre arcos cortos
    95962   // Poema sobre bastones
  ];

  // Función para verificar si un ítem debe ser excluido de la búsqueda de precios
  const shouldSkipMarketCheck = (id, name) => {
    // Verificar por ID
    if (EXCLUDED_ITEM_IDS.includes(id)) {
      return true;
    }
    
    // Verificar por nombre (para items que podrían no estar en la lista)
    if (name) {
      const lowerName = name.toLowerCase();
      // Excluir 'esquirla' excepto 'Esquirla de gloria' (ID 70820)
      if (lowerName.includes('esquirla') && id !== 70820) return true;
      if (lowerName.includes('trébol')) return true;
      if (lowerName.includes('trebol')) return true;
      // Las piedras suelen ser comerciables; solo excluir la rúnica mística
      if (lowerName.includes('piedra rúnica mística')) return true;
      if (lowerName.includes('bendición')) return true;
      if (lowerName.includes('tributo')) return true;
      if (lowerName.includes('esencia')) return true;
      if (lowerName.includes('energía')) return true;
      if (lowerName.includes('energia')) return true;
      if (lowerName.startsWith('don de')) return true;
      if (lowerName.includes(' gift')) return true;
      if (lowerName.endsWith('gift')) return true;
      return false;
    }
    
    return false;
  };

  // Precios fijos para ciertos ítems
  if (ingredient.id === 79418) {  // Piedra rúnica mística
    // Precio fijo: 1g (10000 cobre)
    ingredient.setPrices(10000, 10000);
  }
  // Manejo específico para Piedra imán dracónica amalgamada
  else if (ingredient.id === 92687 || ingredient.id === 96978) {
    const itemId = ingredient.id;
    const itemName = ingredient.name;
    
    
    // Forzar la carga de precios para este ítem
      try {
        const prices = await getPrice(itemId);
        if (prices) {
          ingredient.setPrices(prices.buy_price || 0, prices.sell_price || 0);
        } else {
          ingredient.setPrices(0, 0);
        }
      } catch (error) {
        console.warn(`[ERROR] Error al cargar precios para ${itemName}:`, error.message);
        ingredient.setPrices(0, 0);
      }
    return ingredient; // Retornar después del manejo personalizado
  }
  // Cargar precios para materiales básicos que no estén en la lista de exclusión
  else if (isBasic3GenMaterial(ingredient.id) && !shouldSkipMarketCheck(ingredient.id, ingredient.name)) {
    // Verificar si es un "Don de" o similar que no tiene precios en el mercado
    if (ingredient.name.toLowerCase().startsWith('don de') || 
        ingredient.name.toLowerCase().includes('gift')) {
      ingredient.setPrices(0, 0);
    } else {
      
        try {
          const prices = await getPrice(ingredient.id);
          if (prices) {
            ingredient.setPrices(prices.buy_price || 0, prices.sell_price || 0);
          } else {
            ingredient.setPrices(0, 0);
          }
        } catch (error) {
          console.warn(`[ERROR] Error al cargar precios para ${ingredient.name} (${ingredient.id}):`, error.message);
          ingredient.setPrices(0, 0);
      }
    }
  }

  // Procesar componentes hijos si existen
  if (itemData.components && Array.isArray(itemData.components)) {
    const results = await Promise.allSettled(
      itemData.components.map(componentData => createIngredientTree3(componentData, ingredient))
    );
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        ingredient.addComponent(r.value);
      }
    });
    return ingredient;
  }

  return ingredient;
}

// Importamos la API para usarla en esta función
// Mapeo de materiales básicos, dones y precursores para legendarios
// Fuente: https://wiki-es.guildwars2.com/wiki/Crep%C3%BAsculo

const BASIC_MATERIALS = {
// === MATERIALES T6 ===
24295: { name: 'Vial de sangre poderosa', type: 'crafting_material' },
24283: { name: 'Vesícula de veneno poderoso', type: 'crafting_material' },
24300: { name: 'Tótem elaborado', type: 'crafting_material' },
24277: { name: 'Montón de polvo cristalino', type: 'crafting_material' },
24351: { name: 'Colmillo feroz', type: 'crafting_material' },
24289: { name: 'Escama blindada', type: 'crafting_material' },
24357: { name: 'Garra despiadada', type: 'crafting_material' },
24358: { name: 'Hueso antiguo', type: 'crafting_material' },
19721: { name: 'Pegote de ectoplasma', type: 'crafting_material' }, // Añadido para asegurar el precio

// === LEGENDARIOS ===
30684: { name: 'Colmilloescarcha', type: 'legendary' },
30687: { name: 'Incineradora', type: 'legendary' },
30692: { name: 'El Festín', type: 'legendary' },
30695: { name: 'Meteorológico', type: 'legendary' },
30701: { name: 'Kraitkin', type: 'legendary' },
30691: { name: 'Kamhoali\'i Kotaki', type: 'legendary' },
30697: { name: 'Frenesí', type: 'legendary' },
30698: { name: 'El Bifrost', type: 'legendary' },
30686: { name: 'El Soñador', type: 'legendary' },
30694: { name: 'El Depredador', type: 'legendary' },
30685: { name: 'Kudzu', type: 'legendary' },
30690: { name: 'El Juggernaut', type: 'legendary' },
30689: { name: 'Eternidad', type: 'legendary' },
30703: { name: 'Amanecer', type: 'legendary' },
30702: { name: 'Aullador', type: 'legendary' },
30700: { name: 'Rodgort', type: 'legendary' },
30696: { name: 'Las Profecías del Buscador de la Llama', type: 'legendary' },
30688: { name: 'El Juglar', type: 'legendary' }, 
30699: { name: 'Haz', type: 'legendary' },
30704: { name: 'Crepúsculo', type: 'legendary' },


// === DONES ===
19672: { name: 'Don del poder', type: 'account_bound' },
19673: { name: 'Don de la magia', type: 'account_bound' },
19677: { name: 'Don de la exploración', type: 'account_bound' },
19678: { name: 'Don de la batalla', type: 'account_bound' },
19664: { name: 'Don de Ascalon', type: 'account_bound' },
19674: { name: 'Don del dominio', type: 'account_bound' },
19648: { name: 'Don del Crepúsculo', type: 'crafting_material' },
19621: { name: 'Don del metal', type: 'crafting_material' },
19631: { name: 'Don de la oscuridad', type: 'crafting_material' },
19626: { name: 'Don de la suerte', type: 'crafting_material' },
19665: { name: 'Don del noble', type: 'crafting_material' },
19635: { name: 'Don del entretenimiento', type: 'crafting_material' },
19650: { name: 'Don del Festín', type: 'crafting_material' },
19645: { name: 'Don de Incineradora', type: 'crafting_material' },
19624: { name: 'Don del hielo', type: 'crafting_material' },
19670: { name: 'Don del Santuario', type: 'crafting_material' },
19657: { name: 'Don de Kamohoali\'i Kotaki', type: 'crafting_material' },
19669: { name: 'Don de Zhaitan', type: 'crafting_material' },
19659: { name: 'Don del Frenesí', type: 'crafting_material' },
19643: { name: 'Don del agua', type: 'crafting_material' },
19638: { name: 'Don del color', type: 'crafting_material' },
19654: { name: 'Don del Bifrost', type: 'crafting_material' },
19660: { name: 'Don del Soñador', type: 'crafting_material' },
19628: { name: 'Estatua de unicornio', type: 'crafting_material' },
19667: { name: 'Don de las espinas', type: 'crafting_material' },
19661: { name: 'Don del Depredador', type: 'crafting_material' },
19671: { name: 'Don del conocimiento', type: 'crafting_material' },
19636: { name: 'Don del sigilo', type: 'crafting_material' },
19647: { name: 'Don del Amanecer', type: 'crafting_material' },
19632: { name: 'Don de la luz', type: 'crafting_material' },
19662: { name: 'Don de Aullador', type: 'crafting_material' },
19627: { name: 'Don de la naturaleza', type: 'crafting_material' },
19644: { name: 'Don de Kudzu', type: 'crafting_material' },
19649: { name: 'Don del Juggernaut', type: 'crafting_material' },
19625: { name: 'Don de Colmilloescarcha', type: 'crafting_material' },
19651: { name: 'Don de Gracia', type: 'crafting_material' },
19622: { name: 'Don de la madera', type: 'crafting_material' },
19666: { name: 'Don del herrador', type: 'crafting_material' },
19658: { name: 'Don de Kraitkin', type: 'crafting_material' },
19623: { name: 'Don de la energía', type: 'crafting_material' },
19656: { name: 'Don de Rodgort', type: 'crafting_material' },
19653: { name: 'Don de Las Profecías del Buscador de la Llama', type: 'crafting_material' },
19629: { name: 'Don de la historia', type: 'crafting_material' },
19646: { name: 'Don del Juglar', type: 'crafting_material' },
19630: { name: 'Don de la música', type: 'crafting_material' },
19655: { name: 'Don de Haz', type: 'crafting_material' },
19639: { name: 'Don del relámpago', type: 'crafting_material' },
19652: { name: 'Don del Meteorológico', type: 'crafting_material' },
19637: { name: 'Don del clima', type: 'crafting_material' },
19641: { name: 'Estatua de tiburón', type: 'crafting_material' },

  // === LINGOTES ===
  19688: { name: 'Lingote de acero', type: 'crafting_material' },
  19685: { name: 'Lingote de oricalco', type: 'crafting_material' },
  19684: { name: 'Lingote de mithril', type: 'crafting_material' },
  19683: { name: 'Lingote de hierro', type: 'crafting_material' },
  19681: { name: 'Lingote de aceroscuro', type: 'crafting_material' },
  19686: { name: 'Lingote de platino', type: 'crafting_material' },

// === SELLOS ===
24592: { name: 'Sello superior de vitalidad', type: 'upgrade_component' },
24632: { name: 'Sello superior de veneno', type: 'upgrade_component' },
24612: { name: 'Sello superior de agonía', type: 'upgrade_component' },
24561: { name: 'Sello superior de rabia', type: 'upgrade_component' },
24572: { name: 'Sello superior de invalidación', type: 'upgrade_component' },
24571: { name: 'Sello superior de pureza', type: 'upgrade_component' },
24615: { name: 'Sello superior de fuerza', type: 'upgrade_component' },
24618: { name: 'Sello superior de precisión', type: 'upgrade_component' },
24601: { name: 'Sello superior de batalla', type: 'upgrade_component' },
24554: { name: 'Sello superior de aire', type: 'upgrade_component' },
24584: { name: 'Sello superior de benevolencia', type: 'upgrade_component' },
24562: { name: 'Sello superior de fortaleza', type: 'upgrade_component' },
24865: { name: 'Sello superior de celeridad', type: 'upgrade_component' },
24651: { name: 'Sello superior de sangre', id: 24570, type: 'upgrade_component' },
24555: { name: 'Sello superior de hielo', type: 'upgrade_component' },
24548: { name: 'Sello superior de fuego', type: 'upgrade_component' },
24607: { name: 'Sello superior de energía', type: 'upgrade_component' },

  // === PIEDRAS IMÁN ===
  24310: { name: 'Piedra imán de ónice', type: 'crafting_material' },
  24320: { name: 'Piedra imán glacial', type: 'crafting_material' },
  24340: { name: 'Piedra imán corrupta', type: 'crafting_material' },
  24315: { name: 'Piedra imán fundida', type: 'crafting_material' },
  24325: { name: 'Piedra imán de destructor', type: 'crafting_material' },
  24305: { name: 'Piedra imán cargada', type: 'crafting_material' },
  

  // === TABLAS DE MADERA ===
  19709: { name: 'Tabla de madera ancestral', type: 'crafting_material' },
  19711: { name: 'Tabla de madera sólida', type: 'crafting_material' },
  19712: { name: 'Tabla de madera antigua', type: 'crafting_material' },
  19714: { name: 'Tabla de madera curtida', type: 'crafting_material' },
  19728: { name: 'Tabla de madera de arista', type: 'crafting_material' },

  // === ORBES ===
  24522: { name: 'Orbe de ópalo', type: 'crafting_material' },
  24512: { name: 'Orbe de crisocola', type: 'crafting_material' },

  // === POLVOS ===
  24274: { name: 'Montón de polvo radiante', type: 'crafting_material' },
  24276: { name: 'Montón de polvo incandescente', type: 'crafting_material' },
  24275: { name: 'Montón de polvo luminoso', type: 'crafting_material' },
  24277: { name: 'Montón de polvo cristalino', type: 'crafting_material' },

  // === PRECURSORES ===
  29183: { name: 'Veneno', type: 'weapon' },
  29171: { name: 'Carcharias', type: 'weapon' },
  29180: { name: 'La Leyenda', type: 'weapon' },
  29178: { name: 'El Amante', type: 'weapon' },
  29175: { name: 'El Cazador', type: 'weapon' },
  29170: { name: 'El Coloso', type: 'weapon' },
  29184: { name: 'Aullido', type: 'weapon' },
  29177: { name: 'El Elegido', type: 'weapon' },
  29168: { name: 'El Bardo', type: 'weapon' },
  29181: { name: 'Zas', type: 'weapon' },
  29176: { name: 'Tormenta', type: 'weapon' },
  29172: { name: 'Hoja de Kudzu', type: 'weapon' },
  29167: { name: 'Chispa', type: 'weapon' },
  29166: { name: 'Diente de Colmilloescarcha', type: 'weapon' },
  29173: { name: 'El Energizador', type: 'weapon' },
  29174: { name: 'Pistola del Caos', type: 'weapon' },
  29169: { name: 'Alba', type: 'weapon' },
  29182: { name: 'Llama de Rodgort', type: 'weapon' },
  29185: { name: 'Anochecer', type: 'weapon' },

  
  // === ESTATUAS ===
  19642: { name: 'Estatua de anguila', type: 'crafting_material' },
  19640: { name: 'Estatua de lobo', type: 'crafting_material' },
  19628: { name: 'Estatua de unicornio', type: 'crafting_material' },


  // === OTROS ===
  12545: { name: 'Trufa orriana', type: 'crafting_material' },
  12128: { name: 'Baya omnom', type: 'crafting_material' },
  19732: { name: 'Trozos de cuero endurecido', type: 'crafting_material' },
  19633: { name: 'Vial de azogue', type: 'crafting_material' },
  19634: { name: 'Vial de llama líquida', type: 'crafting_material' },
  20323: { name: 'Tinte sin identificar', type: 'crafting_material' },
  19721: { name: 'Pegote de ectoplasma', type: 'crafting_material' },
  19925: { name: 'Esquirla de obsidiana', type: 'crafting_material' },
  20797: { name: 'Esquirla de hematites', type: 'crafting_material' },
  20796: { name: 'Piedra filosofal', type: 'crafting_material' },
  19976: { name: 'Moneda mística', type: 'crafting_material' },
  19676: { name: 'Piedra rúnica helada', type: 'crafting_material' },
  12544: { name: 'Chile fantasma', type: 'crafting_material' },
  19746: { name: 'Haz de gasa', type: 'crafting_material' },
  24502: { name: 'Doblón de plata', type: 'crafting_material' }, 
  19675: { name: 'Trébol místico', type: 'crafting_material' },
  19737: { name: 'Retal de cuero curado endurecido', type: 'crafting_material' },
  20000: { name: 'Caja de diversión', type: 'crafting_material' },
};
/**
 * Mapeo de ítems legendarios y sus componentes
 * Fuente: https://wiki-es.guildwars2.com/wiki/Crep%C3%BUsculo
 */

// Árbol reutilizable: Don del dominio
const GIFT_OF_MASTERY_TREE = {
  id: 19674,
  name: 'Don del dominio',
  type: 'account_bound',
  count: 1,
  components: [
    { id: 19925, name: 'Esquirla de obsidiana', count: 250 },
    { id: 20797, name: 'Esquirla de hematites', count: 1 },
    { id: 19677, name: 'Don de la exploración', count: 1 },
    { id: 19678, name: 'Don de la batalla', count: 1 }
  ]
};

// Árbol reutilizable: Don de la suerte
const GIFT_OF_FORTUNE_TREE = {
  id: 19626,
  name: 'Don de la suerte',
  type: 'crafting_material',
  count: 1,
  components: [
    { id: 19721, name: 'Pegote de ectoplasma', count: 250 },
    {
      id: 19675,
      name: 'Trébol místico',
      type: 'account_bound',
      count: 77,
      components: [
        { id: 19976, name: 'Moneda mística', count: 250 },
        { id: 19721, name: 'Pegote de ectoplasma', count: 250 },
        { id: 19925, name: 'Esquirla de obsidiana', count: 250 },
        { id: 20796, name: 'Piedra filosofal', count: 1500 }
      ]
    },
    {
      id: 19673,
      name: 'Don de la magia',
      type: 'crafting_material',
      count: 1,
      components: [
        { id: 24295, name: 'Vial de sangre poderosa', count: 250 },
        { id: 24283, name: 'Vesícula de veneno poderoso', count: 250 },
        { id: 24300, name: 'Tótem elaborado', count: 250 },
        { id: 24277, name: 'Montón de polvo cristalino', count: 250 }
      ]
    },
    {
      id: 19672,
      name: 'Don del poder',
      type: 'crafting_material',
      count: 1,
      components: [
        { id: 24351, name: 'Colmillo feroz', count: 250 },
        { id: 24289, name: 'Escama blindada', count: 250 },
        { id: 24357, name: 'Garra despiadada', count: 250 },
        { id: 24358, name: 'Hueso antiguo', count: 250 }
      ]
    }
  ]
};

// Incineradora - Daga legendaria Gen 1
const INCINERATOR_TREE = {
  id: 30687, // ID de la Incineradora
  name: 'Incineradora',
  type: 'legendary',
  components: [
    GIFT_OF_MASTERY_TREE,
    GIFT_OF_FORTUNE_TREE,
    {
      id: 19645, // Don de Incineradora
      name: 'Don de Incineradora',
      type: 'crafting_material',
      count: 1,
      components: [
        { id: 19676, name: 'Piedra rúnica helada', count: 100 },
        { id: 24548, name: 'Sello superior de fuego', count: 1 },
        {
          id: 19621, // Don del metal
          name: 'Don del metal',
          type: 'crafting_material',
          count: 1,
          components: [
            { id: 19685, name: 'Lingote de oricalco', count: 250 },
            { id: 19684, name: 'Lingote de mithril', count: 250 },
            { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
            { id: 19686, name: 'Lingote de platino', count: 250 }
          ]
        },
        {
          id: 19634, // Vial de llama líquida 
          name: 'Vial de llama líquida',
          type: 'crafting_material',
          count: 1,
          components: [
            { id: 19633, name: 'Vial de azogue', count: 1 },
            { id: 12544, name: 'Chile fantasma', count: 250 },
            { id: 24315, name: 'Piedra imán fundida', count: 100 },
            { id: 24325, name: 'Piedra imán de destructor', count: 100 }
          ]
        }
      ]
    },
    {
      id: 29167, // Precursor - Chispa 
      name: 'Chispa',
      type: 'weapon',
      count: 1
    }
  ]
};

const LEGENDARY_ITEMS = {
  // El Festín - Maza legendaria Gen 1
  30692: {
    id: 30692,
    name: 'El Festín',
    type: 'legendary_mace',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19650,  // Don de El Festín
        name: 'Don de El Festín',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24607, name: 'Sello superior de energía', count: 1 },
          {
            id: 19621,  // Don del metal
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 }
            ]
          },
          {
            id: 19635,  // Don del entretenimiento
            name: 'Don del entretenimiento',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19665, name: 'Don del noble', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19746, name: 'Haz de gasa', count: 250 },
              { id: 20000, name: 'Caja de diversión', count: 5 }
            ]
          }
        ]
      },
      {
        id: 29173,  // Precursor - El Energizador
        name: 'El Energizador (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },
  
  // Haz - Bastón legendario Gen 1
  30699: {
    id: 30699,
    name: 'Haz',
    type: 'legendary_staff',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19655,  // Don de Haz
        name: 'Don de Haz',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24554, name: 'Sello superior de aire', count: 1 },
          {
            id: 19621,  // Don del metal
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 }
            ]
          },
          {
            id: 19639,  // Don del relámpago
            name: 'Don del relámpago',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19664, name: 'Don de Ascalon', count: 1 },
              { id: 24305, name: 'Piedra imán cargada', count: 100 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19746, name: 'Haz de gasa', count: 250 }
            ]
          }
        ]
      },
      {
        id: 29181,  // Precursor - Zas
        name: 'Zas (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },
  
  // Las Profecías del Buscador de la Llama - Foco legendario Gen 1
  30696: {
    id: 30696,
    name: 'Las Profecías del Buscador de la Llama',
    type: 'legendary_focus',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19653,  // Don de Las Profecías del Buscador de la Llama
        name: 'Don de Las Profecías del Buscador de la Llama',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24601, name: 'Sello superior de batalla', count: 1 },
          {
            id: 19621,  // Don del metal
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 }
            ]
          },
          {
            id: 19629,  // Don de la historia
            name: 'Don de la historia',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19664, name: 'Don de Ascalon', count: 1 },
              { id: 24277, name: 'Montón de polvo cristalino', count: 250 },
              { id: 19732, name: 'Retal de cuero curado endurecido', count: 250 },
              { id: 24310, name: 'Piedra imán de ónice', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29177,  // Precursor - El Elegido
        name: 'El Elegido (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },
  
  // El Juglar - Arco corto legendario Gen 1
  30688: {
    id: 30688,
    name: 'El Juglar',
    type: 'legendary_shortbow',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19646,  // Don del Juglar
        name: 'Don del Juglar',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24607, name: 'Sello superior de energía', count: 1 },
          {
            id: 19623,  // Don de la energía
            name: 'Don de la energía',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 24277, name: 'Montón de polvo cristalino', count: 250 },
              { id: 24295, name: 'Montón de polvo incandescente', count: 250 },
              { id: 24283, name: 'Montón de polvo luminoso', count: 250 },
              { id: 24289, name: 'Montón de polvo radiante', count: 250 }
            ]
          },
          {
            id: 19630,  // Don de la música
            name: 'Don de la música',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19665, name: 'Don del noble', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19746, name: 'Haz de gasa', count: 250 },
              { id: 24502, name: 'Orbe de ópalo', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29184,  // Precursor - El Bardo
        name: 'El Bardo (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },
  
  // El Meteorológico - Cetro legendario Gen 1
  30695: {
    id: 30695,
    name: 'Meteorológico',
    type: 'legendary_scepter',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19652,  // Don del Meteorológico
        name: 'Don del Meteorológico',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24554, name: 'Sello superior de aire', count: 1 },
          {
            id: 19623,  // Don de la energía
            name: 'Don de la energía',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 24277, name: 'Montón de polvo cristalino', count: 250 },
              { id: 24295, name: 'Montón de polvo incandescente', count: 250 },
              { id: 24283, name: 'Montón de polvo luminoso', count: 250 },
              { id: 24289, name: 'Montón de polvo radiante', count: 250 }
            ]
          },
          {
            id: 19637,  // Don del clima
            name: 'Don del clima',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19671, name: 'Don del conocimiento', count: 1 },
              { id: 24305, name: 'Piedra imán cargada', count: 100 },
              { id: 19732, name: 'Trozos de cuero endurecido', count: 250 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 }
            ]
          }
        ]
      },
      {
        id: 29176,  // Precursor - Tormenta
        name: 'Tormenta (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },
  
  // Colmilloescarcha - Hacha legendaria Gen 1
  30684: {
    id: 30684,
    name: 'Colmilloescarcha',
    type: 'legendary_axe',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19625,
        name: 'Don de Colmilloescarcha',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24555, name: 'Sello superior de hielo', count: 1 },
          {
            id: 19621,
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 }
            ]
          },
          {
            id: 19624,
            name: 'Don del hielo',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19670, name: 'Don del santuario', count: 1 },
              { id: 24340, name: 'Piedra imán corrupta', count: 100 },
              { id: 24320, name: 'Piedra imán glacial', count: 100 },
              { id: 19685, name: 'Fragmento de oricalco', count: 250 },
            ]
          }
        ]
      },
      {
        id: 29166,
        name: 'Diente de colmillo escarcha (precursora)',
        type: 'precursor',
        count: 1
      }
    ]
  },
  // Incineradora - Daga legendaria Gen 1
  30687: INCINERATOR_TREE,

  // El Bifrost - Bastón mágico legendario Gen 1
  30698: {
    id: 30698,
    name: 'El Bifrost',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19654, // Don del Bifrost
        name: 'Don del Bifrost',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24572, name: 'Sello superior de invalidación', count: 1 },
          {
            id: 19623, // Don de la energía
            name: 'Don de la energía',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 24274, name: 'Montón de polvo radiante', count: 250 },
              { id: 24275, name: 'Montón de polvo luminoso', count: 250 },
              { id: 24276, name: 'Montón de polvo incandescente', count: 250 },
              { id: 24277, name: 'Montón de polvo cristalino', count: 250 }
            ]
          },
          {
            id: 19638, // Don del color
            name: 'Don del color',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19669, name: 'Don de Zhaitan', count: 1 },
              { id: 24522, name: 'Orbe de ópalo', count: 100 },
              { id: 24277, name: 'Montón de polvo cristalino', count: 250 },
              { id: 20323, name: 'Tinte sin identificar', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29180, // La Leyenda (precursora)
        name: 'La Leyenda (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // El Soñador - Arco corto legendario Gen 1
  30686: {
    id: 30686,
    name: 'El Soñador',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19660, // Don del Soñador
        name: 'Don del Soñador',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24571, name: 'Sello superior de pureza', count: 1 },
          {
            id: 19622, // Don de la madera
            name: 'Don de la madera',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19712, name: 'Tabla de madera antigua', count: 250 },
              { id: 19709, name: 'Tabla de madera ancestral', count: 250 },
              { id: 19711, name: 'Tabla de madera sólida', count: 250 },
              { id: 19714, name: 'Tabla de madera curtida', count: 250 }
            ]
          },
          {
            id: 19628, // Estatua de unicornio
            name: 'Estatua de unicornio',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19667, name: 'Don de las espinas', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 24522, name: 'Orbe de ópalo', count: 100 },
              { id: 24512, name: 'Orbe de crisocola', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29172, // El Amante (precursora)
        name: 'El Amante (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // El Depredador - Rifle legendario Gen 1
  30694: {
    id: 30694,
    name: 'El Depredador',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19661, // Don del Depredador
        name: 'Don del Depredador',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24615, name: 'Sello superior de fuerza', count: 1 },
          {
            id: 19622, // Don de la madera
            name: 'Don de la madera',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19712, name: 'Tabla de madera antigua', count: 250 },
              { id: 19709, name: 'Tabla de madera ancestral', count: 250 },
              { id: 19711, name: 'Tabla de madera sólida', count: 250 },
              { id: 19714, name: 'Tabla de madera curtida', count: 250 }
            ]
          },
          {
            id: 19636, // Don del sigilo
            name: 'Don del sigilo',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19671, name: 'Don del conocimiento', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 12512, name: 'Trufa orriana', count: 250 },
              { id: 24310, name: 'Piedra imán de ónice', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29175, // El Cazador (precursora)
        name: 'El Cazador (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // Kraitkin - Arpón legendario Gen 1
  30701: {
    id: 30701,
    name: 'Kraitkin',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      // Don de Kraitkin
      {
        id: 19658,
        name: 'Don de Kraitkin',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24632, name: 'Sello superior de veneno', count: 1 },
          {
            id: 19623,
            name: 'Don de la energía',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 24277, name: 'Montón de polvo cristalino', count: 250 },
              { id: 24276, name: 'Montón de polvo incandescente', count: 250 },
              { id: 24275, name: 'Montón de polvo luminoso', count: 250 },
              { id: 24274, name: 'Montón de polvo radiante', count: 250 }
            ]
          },
          // Estatua de anguila
          {
            id: 19642,
            name: 'Estatua de anguila',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19666, name: 'Don del herrador', count: 1 },
              { id: 24289, name: 'Escama blindada', count: 250 },
              { id: 19737, name: 'Retal de cuero curado endurecido', count: 250 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 }
            ]
          }
        ]
      },
      // Precursor: Veneno
      { 
        id: 29183, 
        name: 'Veneno (precursora)',
        type: 'weapon',
        count: 1 
      }
    ]
  },

  // Kamohoali'i Kotaki - Arpón legendario Gen 1
  30691: {
    id: 30691,
    name: 'Kamohoali\'i Kotaki',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      // Don de Kamohoali'i Kotaki
      {
        id: 19657,
        name: 'Don de Kamohoali\'i Kotaki',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24612, name: 'Sello superior de agonía', count: 1 },
          {
            id: 19621,
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 }
            ]
          },
          // Estatua de tiburón
          {
            id: 19641,
            name: 'Estatua de tiburón',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19669, name: 'Don de Zhaitan', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 24289, name: 'Escama blindada', count: 250 },
              { id: 24295, name: 'Vial de sangre poderosa', count: 250 }
            ]
          }
        ]
      },
      // Precursor: Carcharias
      { 
        id: 29171, 
        name: 'Carcharias (precursora)',
        type: 'weapon',
        count: 1 
      }
    ]
  },

  // Frenesí - Daga legendaria Gen 1
  30697: {
    id: 30697,
    name: 'Frenesí',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      // Don del Frenesí
      {
        id: 19659,
        name: 'Don del Frenesí',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24561, name: 'Sello superior de rabia', count: 1 },
          {
            id: 19622,
            name: 'Don de la madera',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19712, name: 'Tabla de madera antigua', count: 250 },
              { id: 19709, name: 'Tabla de madera ancestral', count: 250 },
              { id: 19711, name: 'Tabla de madera sólida', count: 250 },
              { id: 19714, name: 'Tabla de madera curtida', count: 250 }
            ]
          },
          {
            id: 19643,
            name: 'Don del agua',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19670, name: 'Don del Santuario', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 24315, name: 'Piedra imán fundida', count: 250 },
              { id: 24320, name: 'Piedra imán glacial', count: 100 }
            ]
          }
        ]
      },
      // Precursor: Rabia
      { id: 29183, name: 'Veneno (precursora)',
        type: 'weapon',
        count: 1 }
    ]
  },
  
  // Kudzu - Arco largo legendario Gen 1
  30685: {
    id: 30685,
    name: 'Kudzu',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19644, // Don de Kudzu
        name: 'Don de Kudzu',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24865, name: 'Sello superior de celeridad', count: 1 },
          {
            id: 19622, // Don de la madera
            name: 'Don de la madera',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19712, name: 'Tabla de madera antigua', count: 250 },
              { id: 19709, name: 'Tabla de madera ancestral', count: 250 },
              { id: 19711, name: 'Tabla de madera sólida', count: 250 },
              { id: 19714, name: 'Tabla de madera curtida', count: 250 }
            ]
          },
          {
            id: 19627, // Don de la naturaleza
            name: 'Don de la naturaleza',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19667, name: 'Don de las espinas', count: 1 },
              { id: 12128, name: 'Baya omnom', count: 250 },
              { id: 19737, name: 'Retal de cuero curado endurecido', count: 250 },
              { id: 19712, name: 'Tabla de madera antigua', count: 250 }
            ]
          }
        ]
      },
      {
        id: 29171, // Hoja de Kudzu (precursora)
        name: 'Hoja de Kudzu (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // El Juggernaut - Martillo legendario Gen 1
  30690: {
    id: 30690,
    name: 'El Juggernaut',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19649, // Don del Juggernaut
        name: 'Don del Juggernaut',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24584, name: 'Sello superior de benevolencia', count: 1 },
          {
            id: 19621, // Don del metal
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 }
            ]
          },
          {
            id: 19633, // Vial de azogue
            name: 'Vial de azogue',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19666, name: 'Don del herrador', count: 1 },
              { id: 19688, name: 'Lingote de acero', count: 250 },
              { id: 24315, name: 'Piedra imán fundida', count: 150 },
              { id: 24502, name: 'Doblón de plata', count: 250 }
            ]
          }
        ]
      },
      {
        id: 29170, // El Coloso (precursora)
        name: 'El Coloso (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // Amanecer - Espada legendaria Gen 1
  30703: {
    id: 30703,
    name: 'Amanecer',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19647, // Don del Amanecer
        name: 'Don del Amanecer',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24562, name: 'Sello superior de fortaleza', count: 1 },
          {
            id: 19621, // Don del metal
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 }
            ]
          },
          {
            id: 19632, // Don de la luz
            name: 'Don de la luz',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19664, name: 'Don de Ascalon', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19737, name: 'Retal de cuero curado endurecido', count: 250 },
              { id: 24305, name: 'Piedra imán cargada', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29169, // Alba (precursora)
        name: 'Alba (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // Aullador - Cuerno de guerra legendario Gen 1
  30702: {
    id: 30702,
    name: 'Aullador',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19662, // Don de Aullador
        name: 'Don de Aullador',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24618, name: 'Sello superior de precisión', count: 1 },
          {
            id: 19622, // Don de la madera
            name: 'Don de la madera',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19712, name: 'Tabla de madera antigua', count: 250 },
              { id: 19709, name: 'Tabla de madera ancestral', count: 250 },
              { id: 19711, name: 'Tabla de madera sólida', count: 250 },
              { id: 19714, name: 'Tabla de madera curtida', count: 250 }
            ]
          },
          {
            id: 19640, // Estatua de lobo
            name: 'Estatua de lobo',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19667, name: 'Don de las espinas', count: 1 },
              { id: 19737, name: 'Retal de cuero curado endurecido', count: 250 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 24351, name: 'Colmillo feroz', count: 250 }
            ]
          }
        ]
      },
      {
        id: 29184, // Aullido (precursora)
        name: 'Aullido (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // Rodgort - Báculo legendario Gen 1
  30700: {
    id: 30700,
    name: 'Rodgort',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19656, // Don de Rodgort
        name: 'Don de Rodgort',
        type: 'crafting_material',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24548, name: 'Sello superior de fuego', count: 1 },
          {
            id: 19622, // Don de la madera
            name: 'Don de la madera',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19712, name: 'Tabla de madera antigua', count: 250 },
              { id: 19709, name: 'Tabla de madera ancestral', count: 250 },
              { id: 19711, name: 'Tabla de madera sólida', count: 250 },
              { id: 19714, name: 'Tabla de madera curtida', count: 250 }
            ]
          },
          {
            id: 19634, // Vial de llama líquida
            name: 'Vial de llama líquida',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19629, name: 'Don de la historia', count: 1 },
              { id: 12544, name: 'Chile fantasma', count: 250 },
              { id: 24315, name: 'Piedra imán fundida', count: 100 },
              { id: 24325, name: 'Piedra imán de destructor', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29182, // Llama de Rodgort (precursora)
        name: 'Llama de Rodgort (precursora)',
        type: 'weapon',
        count: 1
      }
    ]
  },

  // Crepúsculo - Gran espada legendaria Gen 1
  30704: {
    id: 30704,
    name: 'Crepúsculo',
    type: 'legendary',
    components: [
      GIFT_OF_MASTERY_TREE,
      GIFT_OF_FORTUNE_TREE,
      {
        id: 19648,
        name: 'Don del Crepúsculo',
        type: 'gift',
        count: 1,
        components: [
          { id: 19676, name: 'Piedra rúnica helada', count: 100 },
          { id: 24651, name: 'Sello superior de sangre', count: 1 },
          {
            id: 19621,
            name: 'Don del metal',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19684, name: 'Lingote de mithril', count: 250 },
              { id: 19681, name: 'Lingote de aceroscuro', count: 250 },
              { id: 19686, name: 'Lingote de platino', count: 250 },
            ]
          },
          {
            id: 19631,
            name: 'Don de la oscuridad',
            type: 'crafting_material',
            count: 1,
            components: [
              { id: 19664, name: 'Don de Ascalon', count: 1 },
              { id: 19685, name: 'Lingote de oricalco', count: 250 },
              { id: 19737, name: 'Retal de cuero curado endurecido', count: 250 },
              { id: 24310, name: 'Piedra imán de ónice', count: 100 }
            ]
          }
        ]
      },
      {
        id: 29185,
        name: 'Anochecer (precursora)',
        type: 'precursor',
        count: 1
      }
    ]
  }
};


/**
 * Obtiene los datos de un ítem legendario
 */
function getLegendaryItem(itemId) {
  return LEGENDARY_ITEMS[itemId] || BASIC_MATERIALS[itemId] || null;
}

/**
 * Verifica si un ítem es legendario
 */
function isLegendaryItem(itemId) {
  return !!LEGENDARY_ITEMS[itemId];
}

/**
 * Verifica si un ítem es un material básico
 */
function isBasicMaterial(itemId) {
  return !!BASIC_MATERIALS[itemId];
}
// Materiales básicos para legendarias de 3ra generación
// Basado en la legendaria Desgarro de Aurene

const BASIC_MATERIALS_3GEN = {

// === DON DE JADE ===
// === DON DE JADE ===
96033: { name: 'Don de dominio de jade', type: 'crafting_material' },

  // === MATERIALES DE JADE ===
  97433: { name: 'Don del Imperio del Dragón', type: 'crafting_material' },
  96722: { name: 'Piedra rúnica de jade', type: 'crafting_material' },
  97102: { name: 'Pedazo de jade puro', type: 'crafting_material' },
  96347: { name: 'Pedazo de ámbar gris antiguo', type: 'crafting_material' },
  97829: { name: 'Bendición de la Emperatriz de Jade', type: 'account_bound' },

  // === OTROS DE JADE===
  20797: { name: 'Esquirla de hematites', type: 'crafting_material' },
  96978: { name: 'Piedra de invocación vetusta', type: 'crafting_material' },

  // === MATERIALES DON DE CANTHA ===
  97096: { name: 'Don de Cantha', type: 'account_bound' },
  96993: { name: 'Don de la Provincia de Seitung', type: 'account_bound' },
  95621: { name: 'Don de la ciudad de Nueva Kaineng', type: 'account_bound' },
  97232: { name: 'Don del Bosque Echovald', type: 'account_bound' },
  96083: { name: 'Don de Muerte del Dragón', type: 'account_bound' },

  // === DON DE DRACÓNICO ===
  // === DON DE DRACÓNICO ===
  96137: { name: 'Tributo dracónico', type: 'crafting_material' },

  // === MATERIALES TRÉBOL ===
  19675: { name: 'Trébol místico', type: 'crafting_material' },
  19976: { name: 'Moneda mística', type: 'currency' },
  19721: { name: 'Pegote de ectoplasma', type: 'crafting_material' },
  19925: { name: 'Esquirla de obsidiana', type: 'crafting_material' },
  20799: { name: 'Cristal místico', type: 'crafting_material' },
  20796: { name: 'Piedra filosofal', type: 'crafting_material' },

  // === DONES CONDENSADOS ===
  // Poder
  70867: { name: 'Don de poder condensado', type: 'account_bound' },
  70801: { name: 'Don de garras', type: 'account_bound' },
  75299: { name: 'Don de escamas', type: 'account_bound' },
  71123: { name: 'Don de huesos', type: 'account_bound' },
  75744: { name: 'Don de colmillos', type: 'account_bound' },
  // Magia
  76530: { name: 'Don de magia condensada', type: 'account_bound' },
  71655: { name: 'Don de sangre', type: 'account_bound' },
  71787: { name: 'Don de veneno', type: 'account_bound' },
  73236: { name: 'Don de tótems', type: 'account_bound' },
  73196: { name: 'Don de polvo', type: 'account_bound' },

  // === OTROS DE DRACÓNICO===
  92687: { name: 'Piedra imán dracónica amalgamada', type: 'crafting_material' },

  // === DON DE AURENE CAMBIANTE ===
  // === DON DE AURENE CAMBIANTE ===

  71581: { name: 'Memoria de batalla', type: 'crafting_material' },
  70820: { name: 'Esquirla de gloria', type: 'crafting_material' },
  
  // === MATERIALES DON DE INVESTIGACIÓN ===
  97655: { name: 'Don de investigación', type: 'crafting_material' },
  46747: { name: 'Reactivo termocatalítico', type: 'crafting_material' },
  95813: { name: 'Reactivo hidrocatalítico', type: 'crafting_material' },
  45178: { name: 'Esencia de la suerte exótica', type: 'currency' },

  // === MATERIALES DON DE LA NIEBLA ===
  76427: { name: 'Don de la niebla', type: 'account_bound' },
  70528: { name: 'Don de gloria', type: 'account_bound' },
  19678: { name: 'Don de la batalla', type: 'account_bound' },
  71008: { name: 'Don de guerra', type: 'account_bound' },
  73137: { name: 'Cubo de energía oscura estabilizada', type: 'crafting_material' },
  71994: { name: 'Bola de energía oscura', type: 'crafting_material' },
  73248: { name: 'Matriz estabilizadora', type: 'crafting_material' },

  // === MATERIALES DE POEMA FIJO ===
  96151: { name: 'Relato de aventura', type: 'crafting_material' },
  97790: { name: 'Insignia de farolero', type: 'crafting_material' },
  71148: { name: 'Hoja de papel supremo', type: 'crafting_material' },

  // === POEMAS SEGUN ARMA ===
  97160: { name: 'Poema sobre hachas', type: 'crafting_material' }, // Hacha
  96187: { name: 'Poema sobre dagas', type: 'crafting_material' }, // Daga
  96035: { name: 'Poema sobre mazas', type: 'crafting_material' }, // Maza
  95809: { name: 'Poema sobre pistolas', type: 'crafting_material' }, // Pistola
  96173: { name: 'Poema sobre cetros', type: 'crafting_material' }, // Cetro
  97335: { name: 'Poema sobre espadas', type: 'crafting_material' }, // Espada
  96951: { name: 'Poema sobre focos', type: 'crafting_material' }, // Foco
  95740: { name: 'Poema sobre escudos', type: 'crafting_material' }, // Escudo
  97257: { name: 'Poema sobre antorchas', type: 'crafting_material' }, // Antorcha
  96341: { name: 'Poema sobre cuernos de guerra', type: 'crafting_material' }, // Cuerno de guerra
  96036: { name: 'Poema sobre mandobles', type: 'crafting_material' }, // Mandoble
  97082: { name: 'Poema sobre martillos', type: 'crafting_material' }, // Martillo
  97800: { name: 'Poema sobre arcos largos', type: 'crafting_material' }, // Arco largo
  97201: { name: 'Poema sobre rifles', type: 'crafting_material' }, // Rifle
  96849: { name: 'Poema sobre arcos cortos', type: 'crafting_material' }, // Arco corto
  95962: { name: 'Poema sobre bastones', type: 'crafting_material' }, // Báculo
  
  // === OTROS AURENE FIJOS===
  79418: { name: 'Piedra rúnica mística', type: 'crafting_material' },

// === MATERIALES ORDENADOS POR TIPO DE ARMA ===
45845: { name: 'Filo para hacha de acero de Deldrimor', type: 'crafting_material' },          // Hacha
45846: { name: 'Filo para daga de acero de Deldrimor', type: 'crafting_material' },           // Daga
45852: { name: 'Cabeza para maza de acero de Deldrimor', type: 'crafting_material' },         // Maza
45833: { name: 'Cañón para pistola de acero de Deldrimor', type: 'crafting_material' },       // Pistola
45885: { name: 'Núcleo para cetro de madera espiritual', type: 'crafting_material' },         // Cetro
45848: { name: 'Filo para espada de acero de Deldrimor', type: 'crafting_material' },         // Espada
45884: { name: 'Núcleo para foco de madera espiritual', type: 'crafting_material' },          // Foco
45858: { name: 'Umbo para escudo de acero de Deldrimor', type: 'crafting_material' },         // Escudo
45838: { name: 'Cabezal para antorcha de acero de Deldrimor', type: 'crafting_material' },    // Antorcha
45839: { name: 'Cuerno de acero de Deldrimor', type: 'crafting_material' },                   // Cuerno de guerra
45847: { name: 'Filo para mandoble de acero de Deldrimor', type: 'crafting_material' },       // Mandoble
45851: { name: 'Cabeza para martillo de acero de Deldrimor', type: 'crafting_material' },     // Martillo
45841: { name: 'Duela para arco largo de madera espiritual', type: 'crafting_material' },     // Arco largo
45834: { name: 'Cañón para rifle de acero de Deldrimor', type: 'crafting_material' },         // Rifle
45842: { name: 'Duela para arco corto de madera espiritual', type: 'crafting_material' },     // Arco corto
45887: { name: 'Cabezal para báculo de madera espiritual', type: 'crafting_material' },        // Báculo


// === PRECURSORES ORDENADOS ===
97449: { name: 'Desgarro Dracónico (precursora)', type: 'weapon' }, // Hacha
95967: { name: 'Garra Dracónica (precursora)', type: 'weapon' }, // Daga
96827: { name: 'Cola Dracónica (precursora)', type: 'weapon' }, // Maza
96915: { name: 'Razonamiento Dracónico (precursora)', type: 'weapon' }, // Pistola
96193: { name: 'Sabiduría Dracónica (precursora)', type: 'weapon' }, // Cetro
95994: { name: 'Colmillo Dracónico (precursora)', type: 'weapon' }, // Espada
96303: { name: 'Mirada Dracónica (precursora)', type: 'weapon' }, // Foco
97691: { name: 'Escama Dracónica (precursora)', type: 'weapon' }, // Escudo
96925: { name: 'Aliento Dracónico (precursora)', type: 'weapon' }, // Antorcha
97513: { name: 'Voz Dracónica (precursora)', type: 'weapon' }, // Cuerno de guerra
96357: { name: 'Mordisco Dracónico (precursora)', type: 'weapon' }, // Mandoble
95920: { name: 'Peso Dracónico (precursora)', type: 'weapon' }, // Martillo
95834: { name: 'Vuelo Dracónico (precursora)', type: 'weapon' }, // Arco largo
97267: { name: 'Persuasión Dracónica (precursora)', type: 'weapon' }, // Rifle
96330: { name: 'Ala Dracónica (precursora)', type: 'weapon' }, // Arco corto
95814: { name: 'Reflexión Dracónica (precursora)', type: 'weapon' }, // Báculo


// === LEGENDARIAS ORDENADAS ===
96937: { name: 'Desgarro de Aurene', type: 'legendary' }, // Hacha
96203: { name: 'Garra de Aurene', type: 'legendary' }, // Daga
95612: { name: 'Cola de Aurene', type: 'legendary' }, // Maza
95808: { name: 'Razonamiento de Aurene', type: 'legendary' }, // Pistola
96221: { name: 'Sabiduría de Aurene', type: 'legendary' }, // Cetro
95675: { name: 'Colmillo de Aurene', type: 'legendary' }, // Espada
97165: { name: 'Mirada de Aurene', type: 'legendary' }, // Foco
96028: { name: 'Escama de Aurene', type: 'legendary' }, // Escudo
97099: { name: 'Aliento de Aurene', type: 'legendary' }, // Antorcha
97783: { name: 'Voz de Aurene', type: 'legendary' }, // Cuerno de guerra
96356: { name: 'Mordisco de Aurene', type: 'legendary' }, // Mandoble
95684: { name: 'Peso de Aurene', type: 'legendary' }, // Martillo
97590: { name: 'Vuelo de Aurene', type: 'legendary' }, // Arco largo
97377: { name: 'Persuasión de Aurene', type: 'legendary' }, // Rifle
97077: { name: 'Ala de Aurene', type: 'legendary' }, // Arco corto
96652: { name: 'Reflexión de Aurene', type: 'legendary' }, // Báculo


  
  // ====================
  // === MATERIALES T6 ===
  24295: { name: 'Vial de sangre poderosa', type: 'crafting_material' },
  24283: { name: 'Vesícula de veneno poderoso', type: 'crafting_material' },
  24300: { name: 'Tótem elaborado', type: 'crafting_material' },
  24277: { name: 'Montón de polvo cristalino', type: 'crafting_material' },
  24357: { name: 'Colmillo feroz', type: 'crafting_material' },
  24289: { name: 'Escama blindada', type: 'crafting_material' },
  24351: { name: 'Garra despiadada', type: 'crafting_material' },
  24358: { name: 'Hueso antiguo', type: 'crafting_material' },

  // === MATERIALES T5 ===
  24294: { name: 'Vial de sangre potente', type: 'crafting_material' },
  24282: { name: 'Vesícula de veneno potente', type: 'crafting_material' },
  24299: { name: 'Tótem intrincado', type: 'crafting_material' },
  24276: { name: 'Montón de polvo incandescente', type: 'crafting_material' },
  24356: { name: 'Colmillo grande', type: 'crafting_material' },
  24288: { name: 'Escama grande', type: 'crafting_material' },
  24350: { name: 'Garra grande', type: 'crafting_material' },
  24341: { name: 'Hueso grande', type: 'crafting_material' },

  // === MATERIALES T4 ===
  24293: { name: 'Vial de sangre espesa', type: 'crafting_material' },
  24281: { name: 'Vesícula de veneno llena', type: 'crafting_material' },
  24298: { name: 'Tótem grabado', type: 'crafting_material' },
  24275: { name: 'Montón de polvo luminoso', type: 'crafting_material' },
  24355: { name: 'Colmillo afilado', type: 'crafting_material' },
  24287: { name: 'Escama suave', type: 'crafting_material' },
  24349: { name: 'Garra afilada', type: 'crafting_material' },
  24345: { name: 'Hueso pesado', type: 'crafting_material' },

  // === MATERIALES T3 ===
  24292: { name: 'Vial de sangre', type: 'crafting_material' },
  24280: { name: 'Vesícula de veneno', type: 'crafting_material' },
  24297: { name: 'Tótem', type: 'crafting_material' },
  24274: { name: 'Montón de polvo radiante', type: 'crafting_material' },
  24354: { name: 'Colmillo', type: 'crafting_material' },
  24286: { name: 'Escama', type: 'crafting_material' },
  24348: { name: 'Garra', type: 'crafting_material' },
  24344: { name: 'Hueso', type: 'crafting_material' }


};
/**
 * Mapeo de ítems legendarios de tercera generación y sus componentes
 * Basado en la estructura de Desgarro de Aurene
 */

// Importar materiales básicos de 3ra generación

// === ÁRBOLES REUTILIZABLES ===

// Don de dominio de jade (reutilizable)
const GIFT_OF_JADE_MASTERY_TREE = {
  id: 96033,
  name: 'Don de dominio de jade',
  type: 'crafting_material',
  count: 1,
  components: [
    { 
      id: 97433, 
      name: 'Don del Imperio del Dragón', 
      count: 1,
      components: [
        { id: 96722, name: 'Piedra rúnica de jade', count: 100 },
        { id: 97102, name: 'Pedazo de jade puro', count: 200 },
        { id: 96347, name: 'Pedazo de ámbar gris antiguo', count: 100 },
        { id: 97829, name: 'Bendición de la Emperatriz de Jade', count: 5, type: 'account_bound' }
      ]
    },
    { id: 20797, name: 'Esquirla de hematites', count: 200 },
    { 
      id: 97096, 
      name: 'Don de Cantha',
      type: 'account_bound',
      count: 1,
      components: [
        { id: 96993, name: 'Don de la Provincia de Seitung', count: 1, type: 'account_bound' },
        { id: 95621, name: 'Don de la ciudad de Nueva Kaineng', count: 1, type: 'account_bound' },
        { id: 97232, name: 'Don del Bosque Echovald', count: 1, type: 'account_bound' },
        { id: 96083, name: 'Don de Muerte del Dragón', count: 1, type: 'account_bound' }
      ]
    },
    { id: 96978, name: 'Piedra de invocación vetusta', count: 100 }
  ]
};

// Tributo dracónico (reutilizable)
const DRACONIC_TRIBUTE_TREE = {
  id: 96137,
  name: 'Tributo dracónico',
  type: 'crafting_material',
  count: 1,
  components: [
    { 
      id: 19675,
      name: 'Trébol místico',
      type: 'account_bound',
      count: 38,
      components: [
        { id: 19976, name: 'Moneda mística', count: 38 },
        { id: 19721, name: 'Pegote de ectoplasma', count: 38 },
        { id: 19925, name: 'Esquirla de obsidiana', count: 38 },
        { id: 20799, name: 'Cristal místico', count: 38 }
      ]
    },
    { id: 92687, name: 'Piedra imán dracónica amalgamada', count: 5 },
    { 
      id: 70867,
      name: 'Don de poder condensado',
      type: 'account_bound',
      count: 1,
      components: [
        {
          id: 70801,
          name: 'Don de garras',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24351, name: 'Garra despiadada', count: 100 },
            { id: 24350, name: 'Garra grande', count: 250 },
            { id: 24349, name: 'Garra afilada', count: 50 },
            { id: 24348, name: 'Garra', count: 50 }
          ]
        },
        {
          id: 75299,
          name: 'Don de escamas',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24289, name: 'Escama blindada', count: 100 },
            { id: 24288, name: 'Escama grande', count: 250 },
            { id: 24287, name: 'Escama suave', count: 50 },
            { id: 24286, name: 'Escama', count: 50 }
          ]
        },
        {
          id: 71123,
          name: 'Don de huesos',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24358, name: 'Hueso antiguo', count: 100 },
            { id: 24341, name: 'Hueso grande', count: 250 },
            { id: 24345, name: 'Hueso pesado', count: 50 },
            { id: 24344, name: 'Hueso', count: 50 }
          ]
        },
        {
          id: 75744,
          name: 'Don de colmillos',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24357, name: 'Colmillo feroz', count: 100 },
            { id: 24356, name: 'Colmillo grande', count: 250 },
            { id: 24355, name: 'Colmillo afilado', count: 50 },
            { id: 24354, name: 'Colmillo', count: 50 }
          ]
        }
      ]
    },
    { 
      id: 76530,
      name: 'Don de magia condensada',
      type: 'account_bound',
      count: 1,
      components: [
        {
          id: 71655,
          name: 'Don de sangre',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24295, name: 'Vial de sangre poderosa', count: 100 },
            { id: 24294, name: 'Vial de sangre potente', count: 250 },
            { id: 24293, name: 'Vial de sangre espesa', count: 50 },
            { id: 24292, name: 'Vial de sangre', count: 50 }
          ]
        },
        {
          id: 71787,
          name: 'Don de veneno',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24283, name: 'Vesícula de veneno poderoso', count: 100 },
            { id: 24282, name: 'Vesícula de veneno potente', count: 250 },
            { id: 24281, name: 'Vesícula de veneno llena', count: 50 },
            { id: 24280, name: 'Vesícula de veneno', count: 50 }
          ]
        },
        {
          id: 73236,
          name: 'Don de tótems',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24300, name: 'Tótem elaborado', count: 100 },
            { id: 24299, name: 'Tótem intrincado', count: 250 },
            { id: 24298, name: 'Tótem grabado', count: 50 },
            { id: 24297, name: 'Tótem', count: 50 }
          ]
        },
        {
          id: 73196,
          name: 'Don de polvo',
          type: 'account_bound',
          count: 1,
          components: [
            { id: 24277, name: 'Montón de polvo cristalino', count: 100 },
            { id: 24276, name: 'Montón de polvo incandescente', count: 250 },
            { id: 24275, name: 'Montón de polvo luminoso', count: 50 },
            { id: 24274, name: 'Montón de polvo radiante', count: 50 }
          ]
        }
      ]
    }
  ]
};

// Estructura base del Don de Aurene (compartida entre todas las armas)
const GIFT_OF_AURENE_BASE = {
  type: 'account_bound',
  count: 1,
  components: [
    // El poema se inyectará aquí
    { id: 79418, name: 'Piedra rúnica mística', count: 100, type: 'crafting_material' },
    { 
      id: 97655,
      name: 'Don de Investigación',
      type: 'account_bound',
      count: 1,
      components: [
        { id: 46747, name: 'Reactivo termocatalítico', count: 250, type: 'crafting_material' },
        { id: 95813, name: 'Reactivo hidrocatalítico', count: 250, type: 'crafting_material' },
        { id: 45178, name: 'Esencia de la suerte exótica', count: 250, type: 'currency' }
      ]
    },
    { 
      id: 76427,
      name: 'Don de la Niebla',
      type: 'account_bound',
      count: 1,
      components: [
        { 
  id: 70528, 
  name: 'Don de gloria', 
  count: 1, 
  type: 'account_bound',
  components: [
    { id: 70820, name: 'Esquirla de gloria', count: 250, type: 'crafting_material' }
  ]
},
        { id: 19678, name: 'Don de la batalla', count: 1, type: 'account_bound' },
        { 
  id: 71008, 
  name: 'Don de guerra', 
  count: 1, 
  type: 'account_bound',
  components: [
    { id: 71581, name: 'Memoria de batalla', count: 250, type: 'crafting_material' }
  ]
},
        { 
          id: 73137,
          name: 'Cubo de energía oscura estabilizada',
          type: 'crafting_material',
          count: 1,
          components: [
            { id: 71994, name: 'Bola de energía oscura', count: 1, type: 'crafting_material' },
            { id: 73248, name: 'Matriz estabilizadora', count: 75, type: 'crafting_material' }
          ]
        }
      ]
    }
  ]
};

// Función auxiliar para obtener el tipo de arma basado en su nombre
function getWeaponType(weaponName) {
  const weaponTypes = {
    'hacha': ['hacha', 'desgarro'],
    'daga': ['daga', 'garra'],
    'maza': ['maza', 'cola'],
    'pistola': ['pistola', 'razonamiento'],
    'cetro': ['cetro', 'sabiduría'],
    'espada': ['espada', 'colmillo'],
    'foco': ['foco', 'mirada'],
    'escudo': ['escudo', 'escama'],
    'antorcha': ['antorcha', 'aliento'],
    'cuerno': ['cuerno', 'voz'],
    'mandoble': ['mandoble', 'mordisco'],
    'martillo': ['martillo', 'peso'],
    'arco_largo': ['arco largo', 'vuelo'],
    'rifle': ['rifle', 'persuasión'],
    'arco_corto': ['arco corto', 'ala'],
    'baston': ['báculo', 'reflexión']
  };

  const lowerName = weaponName.toLowerCase();
  for (const [type, keywords] of Object.entries(weaponTypes)) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return type;
    }
  }
  return 'desconocido';
}

// Función auxiliar para obtener el nombre del material por su ID
function getMaterialName(materialId) {
  return BASIC_MATERIALS_3GEN[materialId]?.name || `Material ${materialId}`;
}

// Función para crear el poema específico de cada arma
const createWeaponPoem = (weaponId, weaponName, weaponMaterialId) => {
  // Mapeo de tipos de arma a IDs de poema
  const POEM_IDS = {
    'hacha': 97160,
    'daga': 96187,
    'maza': 96035,
    'pistola': 95809,
    'cetro': 96173,
    'espada': 97335,
    'foco': 96951,
    'escudo': 95740,
    'antorcha': 97257,
    'cuerno': 96341,
    'mandoble': 96036,
    'martillo': 97082,
    'arco_largo': 97800,
    'rifle': 97201,
    'arco_corto': 96849,
    'baston': 95962
  };

  // Obtener el ID del poema basado en el tipo de arma
  const weaponType = getWeaponType(weaponName);
  const poemId = POEM_IDS[weaponType] || 0;

  return {
    id: poemId,
    name: `Poema sobre ${weaponName}`,
    type: 'account_bound',
    count: 1,
    components: [
      { id: 96151, name: 'Relato de aventura', count: 10, type: 'crafting_material' },
      { id: 97790, name: 'Insignia de farolero', count: 10, type: 'crafting_material' },
      { id: weaponMaterialId, name: getMaterialName(weaponMaterialId), count: 1, type: 'crafting_material' },
      { id: 71148, name: 'Hoja de papel supremo', count: 1, type: 'crafting_material' }
    ]
  };
};

// Función principal para crear el don de un arma específica
const createGiftOfAurenesRendering = (weaponId, weaponName, weaponMaterialId) => {
  // Crear una copia profunda del objeto base
  const gift = JSON.parse(JSON.stringify(GIFT_OF_AURENE_BASE));
  
  // Configurar propiedades específicas del arma
  gift.id = weaponId;
  gift.name = `Don de ${weaponName}`;
  
  // Insertar el poema específico del arma al inicio de los componentes
  gift.components.unshift(createWeaponPoem(weaponId, weaponName, weaponMaterialId));
  
  return gift;
};

// Mapeo de armas a sus IDs de material y precursora
const WEAPON_DATA = {
  // Hacha
  'Desgarro de Aurene': { id: 96937, materialId: 45845, precursorId: 97449 },
  // Daga
  'Garra de Aurene': { id: 96203, materialId: 45846, precursorId: 95967 },
  // Maza
  'Cola de Aurene': { id: 95612, materialId: 45852, precursorId: 96827 },
  // Pistola
  'Razonamiento de Aurene': { id: 95808, materialId: 45833, precursorId: 96915 },
  // Cetro
  'Sabiduría de Aurene': { id: 96221, materialId: 45885, precursorId: 96193 },
  // Espada
  'Colmillo de Aurene': { id: 95675, materialId: 45848, precursorId: 95994 },
  // Foco
  'Mirada de Aurene': { id: 97165, materialId: 45884, precursorId: 96303 },
  // Escudo
  'Escama de Aurene': { id: 96028, materialId: 45858, precursorId: 97691 },
  // Antorcha
  'Aliento de Aurene': { id: 97099, materialId: 45838, precursorId: 96925 },
  // Cuerno de guerra
  'Voz de Aurene': { id: 97783, materialId: 45839, precursorId: 97513 },
  // Mandoble
  'Mordisco de Aurene': { id: 96356, materialId: 45847, precursorId: 96357 },
  // Martillo
  'Peso de Aurene': { id: 95684, materialId: 45851, precursorId: 95920 },
  // Arco largo
  'Vuelo de Aurene': { id: 97590, materialId: 45841, precursorId: 95834 },
  // Rifle
  'Persuasión de Aurene': { id: 97377, materialId: 45834, precursorId: 97267 },
  // Arco corto
  'Ala de Aurene': { id: 97077, materialId: 45842, precursorId: 96330 },
  // Báculo
  'Reflexión de Aurene': { id: 96652, materialId: 45887, precursorId: 95814 }
};

// Función para crear la entrada de un arma legendaria
const createLegendaryWeapon = (weaponName) => {
  const data = WEAPON_DATA[weaponName];
  if (!data) return null;
  
  return {
    id: data.id,
    name: weaponName,
    type: 'legendary',
    components: [
      { ...GIFT_OF_JADE_MASTERY_TREE },
      { ...DRACONIC_TRIBUTE_TREE },
      createGiftOfAurenesRendering(data.id, weaponName, data.materialId),
      { 
        id: data.precursorId, 
        name: `${weaponName.replace(' de Aurene', ' Dracónic' + (weaponName.endsWith('a') ? 'a' : 'o'))} (precursora)`, 
        type: 'weapon' 
      }
    ]
  };
};

// Objeto principal de ítems legendarios de 3ra generación
const LEGENDARY_ITEMS_3GEN = Object.fromEntries(
  Object.keys(WEAPON_DATA).map(weaponName => {
    const weapon = createLegendaryWeapon(weaponName);
    return [weapon.id, weapon];
  })
);

// Funciones de utilidad
function getLegendary3GenItem(itemId) {
  return LEGENDARY_ITEMS_3GEN[itemId] || null;
}

function isLegendary3GenItem(itemId) {
  return itemId in LEGENDARY_ITEMS_3GEN;
}

function isBasic3GenMaterial(itemId) {
  // Depuración para Vial de sangre espesa
  if (itemId === 24293) {
  }
  return String(itemId) in BASIC_MATERIALS_3GEN;
}
// Shared logic for legendary crafting apps

class LegendaryCraftingBase {
  constructor(config) {
    this.getItemById = config.getItemById;
    this.items = config.items || [];
    this.createIngredientTree = config.createIngredientTree;
    this.isBasicMaterial = config.isBasicMaterial || (() => false);
    this.quickLoadButtons = config.quickLoadButtons || {};
    // Opcional: lista de textos personalizados para reemplazar precios de ciertos materiales
    // Cada entrada puede definir un nombre exacto y palabras clave para coincidencias flexibles
    // {
    //   name: 'Esquirla de obsidiana',
    //   display: 'Se compra con karma o laureles',
    //   keywords: ['obsidiana']
    // }
    this.customPriceTexts = config.customPriceTexts || [];
    const ids = config.elementIds || {};
    this.craftingTreeEl = document.getElementById(ids.craftingTree);
    this.skeletonEl = ids.skeleton ? document.getElementById(ids.skeleton) : null;
    this.summaryEl = document.getElementById(ids.summary);
    this.summaryContentEl = document.getElementById(ids.summaryContent);
    this.loadTreeBtn = ids.loadTree ? document.getElementById(ids.loadTree) : null;
    this.clearCacheBtn = ids.clearCache ? document.getElementById(ids.clearCache) : null;
    this.itemIdInput = ids.itemIdInput ? document.getElementById(ids.itemIdInput) : null;
    this.itemNameInput = ids.itemNameInput ? document.getElementById(ids.itemNameInput) : null;

    this.currentTree = null;
    this.isLoading = false;
    this.activeButton = null;
    this.workerTotals = { totalBuy: 0, totalSell: 0, totalCrafted: 0 };

    this.calculateComponentsPrice = this.calculateComponentsPrice.bind(this);
    this.initializeEventListeners();
  }

  _setActiveButton(button) {
    document.querySelectorAll('.item-tab-btn-treeleg').forEach(btn => btn.classList.remove('active'));
    if (button) {
      button.classList.add('active');
      this.activeButton = button;
    } else {
      this.activeButton = null;
    }
  }

  _findButtonIdByItemId(itemId) {
    const itemIdStr = String(itemId);
    const entry = Object.entries(this.quickLoadButtons).find(([_, d]) => d.itemId === itemIdStr);
    return entry ? entry[0] : null;
  }

  _handleQuickLoad(buttonId) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    const data = this.quickLoadButtons[buttonId];
    if (!data) return;
    if (this.itemIdInput) this.itemIdInput.value = data.itemId;
    if (this.itemNameInput) this.itemNameInput.value = data.itemName || '';
    this._setActiveButton(button);
    this.loadItem({ itemId: data.itemId });
  }

  initializeEventListeners() {
    if (this.loadTreeBtn) {
      this.loadTreeBtn.addEventListener('click', () => {
        this._setActiveButton(null);
        this.loadItem({ itemId: this.itemIdInput?.value, itemName: this.itemNameInput?.value });
      });
    }

    if (this.clearCacheBtn) {
      this.clearCacheBtn.addEventListener('click', () => {
        this.clearCache();
        this._setActiveButton(null);
      });
    }

    Object.keys(this.quickLoadButtons).forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => this._handleQuickLoad(id));
    });
  }

  async updateTotals() {
    if (!this.currentTree) return;
    try {
      const adapted = adaptIngredientForWorker(this.currentTree);
      const treeForWorker = [adapted];
      treeForWorker.forEach(_mapQtyToCount);
      const { updatedTree, totals } = await runCostsWorker(treeForWorker, 1);
      if (Array.isArray(updatedTree) && updatedTree[0]) {
        applyWorkerData(updatedTree[0], this.currentTree);
      }
      this.workerTotals = totals || { totalBuy: 0, totalSell: 0, totalCrafted: 0 };
    } catch (e) {
      console.warn('costsWorker no disponible, usando cálculo local', e);
      const fallback = this.currentTree.calculateTotals();
      this.workerTotals = {
        totalBuy: fallback.buy || 0,
        totalSell: fallback.sell || 0,
        totalCrafted: fallback.buy || 0
      };
    }
  }

  async loadItem({ itemId, itemName }) {
    const id = parseInt(itemId);
    const name = itemName ? itemName.toLowerCase() : '';
    if (!id && !name) {
      this.showError('Por favor ingresa un ID o nombre de ítem válido');
      return;
    }

      this.setLoading(true);

    try {
      let itemData = null;
      if (id) itemData = this.getItemById(id);
      if (!itemData && name) {
        itemData = this.items.find(i => i.name.toLowerCase() === name);
      }
      if (!itemData) throw new Error(`No se encontró información local para el ítem: ${itemName || itemId}`);

      if (this.itemIdInput && itemData.id) this.itemIdInput.value = itemData.id;
      const buttonId = this._findButtonIdByItemId(itemData.id);
        if (buttonId) {
          const button = document.getElementById(buttonId);
          this._setActiveButton(button);
        } else {
          this._setActiveButton(null);
        }

        this.currentTree = await this.createIngredientTree(itemData);
        await this.updateTotals();
      await this.renderTree();
      this.renderSummary();
    } catch (error) {
      console.error('Error al cargar el árbol:', error);
      this.showError(`Error: ${error.message}`);
    } finally {
      this.setLoading(false);
    }
  }

    async renderTree() {
      if (!this.currentTree || !this.craftingTreeEl) return;
      this.craftingTreeEl.innerHTML = '';
      try {
        await this.renderIngredient(this.currentTree, this.craftingTreeEl);
        this.summaryEl.style.display = 'block';
      } catch (error) {
      console.error('Error al renderizar el árbol de crafteo:', error);
      this.craftingTreeEl.innerHTML = `
        <div class="error">
          <p>Error al cargar el árbol de crafteo. Por favor, inténtalo de nuevo.</p>
          <button id="retry-load-tree" class="btn">Reintentar</button>
        </div>`;
      const retryBtn = document.getElementById('retry-load-tree');
      if (retryBtn) retryBtn.addEventListener('click', () => this.loadItem({ itemId: this.itemIdInput?.value, itemName: this.itemNameInput?.value }));
    }
  }

  async renderIngredient(ingredient, container, depth = 0) {
    if (!ingredient) return;
    const itemEl = document.createElement('div');
    itemEl.className = 'tree-node';
    const hasChildren = ingredient.components && ingredient.components.length > 0;
    const isExpanded = depth < 2;
    let itemClass = 'item-card-treeleg';
    if (ingredient.type?.includes('legendary')) itemClass += ' legendary';
    if (ingredient.type?.includes('precursor')) itemClass += ' precursor';
    if (ingredient.type === 'account_bound') itemClass += ' account-bound';

    try {
      const iconUrl = await this.getIconUrl(ingredient);
      const rarityClass = typeof getRarityClass === 'function' ? getRarityClass(ingredient.rarity) : '';
      const normalizedName = ingredient.name ? ingredient.name.toLowerCase() : '';
      // Buscar si este ingrediente tiene un mensaje de precio personalizado
      const customText = this.customPriceTexts.find(ct => {
        if (!ct) return false;
        const n = ct.name ? ct.name.toLowerCase() : '';
        const nameMatch = n && n === normalizedName;
        const keywordMatch = ct.keywords && ct.keywords.some(k => normalizedName.includes(k.toLowerCase()));
        return nameMatch || keywordMatch;
      });
      const vialesConPrecio = [
        'vial de sangre poderosa',
        'vial de sangre potente',
        'vial de sangre fuerte',
        'vial de sangre',
        'vial de sangre débil'
      ];
      const isVial = normalizedName.includes('vial') && !vialesConPrecio.some(v => normalizedName === v);
      const hasComponents = hasChildren;

      const isLegendary = ingredient.type?.includes('legendary');
      const hasBuyPrice = ingredient.buyPrice > 0;
      const hasSellPrice = ingredient.sellPrice > 0;
      const showPrice = !customText && (this.isBasicMaterial(ingredient.id) || ingredient.isPriceLoaded() || (isLegendary && (hasBuyPrice || hasSellPrice)));
      let totalBuyPrice = typeof ingredient.total_buy === 'number' ? ingredient.total_buy : ingredient.getTotalBuyPrice();
      let totalSellPrice = typeof ingredient.total_sell === 'number' ? ingredient.total_sell : ingredient.getTotalSellPrice();

      if ((!totalBuyPrice || !totalSellPrice) && hasComponents) {
        const compPrices = this.calculateComponentsPrice(ingredient);
        if (!totalBuyPrice && compPrices.buy > 0) totalBuyPrice = compPrices.buy;
        if (!totalSellPrice && compPrices.sell > 0) totalSellPrice = compPrices.sell;
      }

      let priceTooltip = '';
      if (customText) {
        priceTooltip = customText.display;
      } else if ((ingredient.isPriceLoaded() || isLegendary || hasComponents) && (totalBuyPrice > 0 || totalSellPrice > 0)) {
        const buyText = totalBuyPrice > 0 ? `Compra: ${formatGold(totalBuyPrice)}` : 'Compra: N/A';
        const sellText = totalSellPrice > 0 ? `Venta: ${formatGold(totalSellPrice)}` : 'Venta: N/A';
        priceTooltip = `${buyText} | ${sellText}${(!hasBuyPrice || !hasSellPrice) && hasComponents ? ' (calculado de componentes)' : ''}`;
      } else if (hasComponents) {
        priceTooltip = 'Precio calculado de los componentes';
      } else if (isVial) {
        priceTooltip = 'No comerciable';
      } else {
        priceTooltip = 'Precio no disponible';
      }

      const priceClass = showPrice ? 'has-price' : (customText ? 'custom-text' : 'no-price');
      const priceContent = showPrice
        ? `<div class="price-row"><span class="price-label">Compra:</span><span class="price-amount">${formatGoldColored(totalBuyPrice)}</span></div>` +
          `<div class="price-row"><span class="price-label">Venta:</span><span class="price-amount">${formatGoldColored(totalSellPrice)}</span></div>`
        : (customText ? customText.display : '');

      itemEl.innerHTML = `
        <div class="${itemClass}">
          ${hasChildren ? `<button class="toggle-children" data-expanded="${isExpanded}">${isExpanded ? '−' : '+'}</button>` : '<div style="width: 24px;"></div>'}
          <img class="item-icon" src="${iconUrl}" alt="${ingredient.name || 'Item'}" title="${ingredient.name || 'Item'}" onerror="this.onerror=null;this.src='${this._getDefaultIconUrl()}';">
          <div class="item-name ${rarityClass}">
            ${isLegendary ? `<a href="/item?id=${ingredient.id}" class="item-link" target="_blank">${ingredient.name || 'Item'}</a>` : (ingredient.name || 'Item')}
          </div>
            <div class="item-details">
              ${ingredient.count > 1 ? `<span class="item-count">x${Math.round(ingredient.count)}</span>` : ''}
              <div class="item-price-container ${priceClass}" title="${priceTooltip}">
              ${priceContent}
            </div>
          </div>
        </div>`;

      container.appendChild(itemEl);

      if (hasChildren) {
        const toggleBtn = itemEl.querySelector('.toggle-children');
        if (toggleBtn) {
          toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const subItems = itemEl.nextElementSibling;
            const expanded = toggleBtn.getAttribute('data-expanded') === 'true';
            if (expanded) {
              subItems.style.display = 'none';
              toggleBtn.textContent = '+';
              toggleBtn.setAttribute('data-expanded', 'false');
            } else {
              subItems.style.display = 'block';
              toggleBtn.textContent = '−';
              toggleBtn.setAttribute('data-expanded', 'true');
            }
          });
        }
        const subItemsEl = document.createElement('div');
        subItemsEl.className = 'sub-items';
        subItemsEl.style.display = isExpanded ? 'block' : 'none';
        container.appendChild(subItemsEl);
        const promises = ingredient.components.map(c => this.renderIngredient(c, subItemsEl, depth + 1));
        await Promise.all(promises);
      }
    } catch (error) {
      console.error('Error al renderizar ingrediente:', error);
      itemEl.innerHTML = `<div class="item-card-treeleg"><div class="item-name">Error al cargar el ítem</div></div>`;
      container.appendChild(itemEl);
    }
  }

  showMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.textContent = message;
    if (this.craftingTreeEl) {
      this.craftingTreeEl.innerHTML = '';
      this.craftingTreeEl.appendChild(messageEl);
      setTimeout(() => {
        if (messageEl.parentNode === this.craftingTreeEl) {
          this.craftingTreeEl.removeChild(messageEl);
        }
      }, 3000);
    }
  }

  showError(message) {
    if (this.craftingTreeEl) {
      this.craftingTreeEl.innerHTML = `<div class="error"><strong>Error:</strong> ${message}</div>`;
    }
    if (this.summaryEl) this.summaryEl.style.display = 'none';
  }

  renderProfitSummary(sellPrice, buyPrice, craftingCost) {
    if (!this.summaryEl || !sellPrice || !craftingCost) return;
    const existing = this.summaryEl.querySelectorAll('.summary-profit');
    existing.forEach(s => s.remove());
    const profitSell = Math.round((sellPrice * 0.85) - craftingCost);
    const profitBuy = Math.round((buyPrice * 0.85) - craftingCost);
    const profitEl = document.createElement('div');
    profitEl.className = 'summary-profit';
    profitEl.innerHTML = `
      <h3>Resumen de Ganancias</h3>
      <div class="summary-subsection">
        <h4>Por venta listada</h4>
        <div class="summary-item"><span>Precio de venta (85%):</span><span>${formatGoldColored(Math.round(sellPrice * 0.85))}</span></div>
        <div class="summary-item"><span>Costo de crafteo:</span><span>${formatGoldColored(craftingCost)}</span></div>
        <div class="summary-item profit-total"><strong>Ganancia estimada:</strong><strong style="color: ${profitSell >= 0 ? 'var(--success)' : 'var(--error)'};">${formatGoldColored(profitSell)}</strong></div>
      </div>
      <div class="summary-subsection" style="margin-top: 15px;">
        <h4>Por venta directa</h4>
        <div class="summary-item"><span>Precio de compra (85%):</span><span>${formatGoldColored(Math.round(buyPrice * 0.85))}</span></div>
        <div class="summary-item"><span>Costo de crafteo:</span><span>${formatGoldColored(craftingCost)}</span></div>
        <div class="summary-item profit-total"><strong>Ganancia estimada:</strong><strong style="color: ${profitBuy >= 0 ? 'var(--success)' : 'var(--error)'};">${formatGoldColored(profitBuy)}</strong></div>
      </div>
      <div class="summary-note"><small>Nota: Los precios de materiales mostrados están calculados de acuerdo a la oferta y demanda del mercado. Y no contempla otros métodos de obtención como puede ser la "Forja Mística".</small><br><small>Nota 2: El precio para el trébol místico se ocupa la cantidad promedio que se requiere para obtener los 77 tréboles, por lo que según el RNG puede variar.</small></div>`;
    this.summaryEl.appendChild(profitEl);
  }

  renderSummary() {
    if (!this.currentTree) return;
    const marketBuy = this.currentTree.getTotalBuyPrice();
    const marketSell = this.currentTree.getTotalSellPrice();
    const craftingCost = this.workerTotals ? this.workerTotals.totalBuy : this.calculateComponentsPrice(this.currentTree).buy;

    let html = `
      <div class="summary-item"><span>Precio venta:</span><span>${marketSell > 0 ? formatGoldColored(marketSell) : 'N/A'}</span></div>
      <div class="summary-item"><span>Precio compra:</span><span>${marketBuy > 0 ? formatGoldColored(marketBuy) : 'N/A'}</span></div>`;
    if (craftingCost > 0) {
      html += `<div class="summary-item"><strong>Costo de crafteo total:</strong><strong>${formatGoldColored(craftingCost)}</strong></div>`;
    }
    if (craftingCost === 0) {
      html += `<div class="summary-item"><span>Información de crafteo:</span><span>No disponible para todos los componentes</span></div>`;
    }

    this.summaryContentEl.innerHTML = html;
    if (marketBuy > 0 && marketSell > 0 && craftingCost > 0) {
      // La ganancia se calcula usando el precio de venta (sell) y de compra (buy)
      this.renderProfitSummary(marketSell, marketBuy, craftingCost);
    }
  }

    setLoading(isLoading) {
      this.isLoading = isLoading;
      if (this.skeletonEl) this.skeletonEl.classList.toggle('hidden', !isLoading);
      if (this.craftingTreeEl && isLoading) {
        this.craftingTreeEl.innerHTML = '';
      }
      if (this.summaryEl) this.summaryEl.classList.toggle('hidden', isLoading);
    }

  async getIconUrl(ingredient) {
    if (!ingredient) return this._getDefaultIconUrl();
    try {
      if (typeof ingredient._generateIconUrl === 'function') return await ingredient._generateIconUrl();
      if (ingredient.icon) {
        if (ingredient.icon.startsWith('http')) return ingredient.icon;
        if (ingredient.icon.includes('/')) return `https://render.guildwars2.com/file/${ingredient.icon}`;
        return `https://render.guildwars2.com/file/${ingredient.icon}.png`;
      }
      if (ingredient.id) return `https://render.guildwars2.com/file/${ingredient.id}.png`;
      return this._getDefaultIconUrl();
    } catch (e) {
      console.error('[getIconUrl] Error al obtener icono', e);
      return this._getDefaultIconUrl();
    }
  }

  calculateComponentsPrice(ingredient) {
    if (!ingredient.components || ingredient.components.length === 0) {
      return { buy: 0, sell: 0 };
    }
    return ingredient.components.reduce((totals, component) => {
      const buyPrice = component.buyPrice > 0 ? component.buyPrice * component.count : 0;
      const sellPrice = component.sellPrice > 0 ? component.sellPrice * component.count : 0;
      const compPrices = this.calculateComponentsPrice(component);
      const scaledBuy = compPrices.buy * component.count;
      const scaledSell = compPrices.sell * component.count;
      return {
        buy: totals.buy + buyPrice + scaledBuy,
        sell: totals.sell + sellPrice + scaledSell
      };
    }, { buy: 0, sell: 0 });
  }

  _getDefaultIconUrl() {
    return 'https://render.guildwars2.com/file/0120CB0368B7953F0D3BD2A0C9100BCF0839FF4D/219035.png';
  }

  clearCache() {
      const successGW2 = gw2API.clearCache();
      const successDW2 = clearPriceCache ? clearPriceCache() : true;
      if (successGW2 && successDW2) {
      alert('Caché limpiado correctamente');
      if (this.currentTree) this.loadItem({ itemId: this.itemIdInput?.value, itemName: this.itemNameInput?.value });
    } else {
      alert('Error al limpiar la caché');
    }
  }
}

if (typeof window !== 'undefined') {
  window.LegendaryUtils = { LegendaryCraftingBase, Ingredient };
}

const quickLoadButtons1 = {
  btnTwilight: { id: 'btnTwilight', itemId: '30704', itemName: 'Crepúsculo' },
  btnFrostfang: { id: 'btnFrostfang', itemId: '30684', itemName: 'Colmillo escarcha' },
  btnIncineradora: { id: 'btnIncineradora', itemId: '30687', itemName: 'Incineradora' },
  btnFestin: { id: 'btnFestin', itemId: '30692', itemName: 'El Festín' },
  btnMeteorologico: { id: 'btnMeteorologico', itemId: '30695', itemName: 'Meteorológico' },
  btnHaz: { id: 'btnHaz', itemId: '30699', itemName: 'Haz' },
  btnJuglar: { id: 'btnJuglar', itemId: '30688', itemName: 'El Juglar' },
  btnKotaki: { id: 'btnKotaki', itemId: '30691', itemName: "Kamohoali'i Kotaki" },
  btnKraitkin: { id: 'btnKraitkin', itemId: '30701', itemName: 'Kraitkin' },
  btnProfecias: { id: 'btnProfecias', itemId: '30696', itemName: 'Las Profecías del Buscador de la Llama' },
  btnRodgort: { id: 'btnRodgort', itemId: '30700', itemName: 'Rodgort' },
  btnAullador: { id: 'btnAullador', itemId: '30702', itemName: 'Aullador' },
  btnAmanecer: { id: 'btnAmanecer', itemId: '30703', itemName: 'Amanecer' },
  btnJuggernaut: { id: 'btnJuggernaut', itemId: '30690', itemName: 'El Juggernaut' },
  btnKudzu: { id: 'btnKudzu', itemId: '30685', itemName: 'Kudzu' },
  btnDepredador: { id: 'btnDepredador', itemId: '30694', itemName: 'El Depredador' },
  btnSonador: { id: 'btnSonador', itemId: '30686', itemName: 'El Soñador' },
  btnBifrost: { id: 'btnBifrost', itemId: '30698', itemName: 'El Bifrost' },
  btnFrenesi: { id: 'btnFrenesi', itemId: '30697', itemName: 'Frenesí' }
};

// Mensajes personalizados para ítems sin precio en el mercado
const customPriceTexts1 = [
  { name: 'Don de la exploración', display: 'Recompensa por completar mapas', keywords: ['exploraci'] },
  { name: 'Don de la batalla', display: 'Recompensa por completar la ruta del don de la batalla en WvW', keywords: ['don de la batalla'] },
  { name: 'Esquirla de hematites', display: 'Se compra en la forja mística', keywords: ['hematites'] },
  { name: 'Esquirla de obsidiana', display: 'Se compra por karma con NPC', keywords: ['obsidiana'] }
];

window.appFirstGen = new LegendaryCraftingBase({
  getItemById: id => getLegendaryItem(parseInt(id)),
  items: Object.values(LEGENDARY_ITEMS),
  createIngredientTree: createIngredientTree1,
  isBasicMaterial,
  quickLoadButtons: quickLoadButtons1,
  customPriceTexts: customPriceTexts1,
    elementIds: {
      craftingTree: 'craftingTree',
      skeleton: 'craftingTreeSkeleton',
      summary: 'summary',
      summaryContent: 'summaryContent',
      clearCache: 'clearCache'
    }
  });

const quickLoadButtons3 = {
  btnDesgarro: { id: 'btnDesgarro', itemId: '96937', itemName: 'Desgarro de Aurene' },
  btnGarra: { id: 'btnGarra', itemId: '96203', itemName: 'Garra de Aurene' },
  btnCola: { id: 'btnCola', itemId: '95612', itemName: 'Cola de Aurene' },
  btnRazonamiento: { id: 'btnRazonamiento', itemId: '95808', itemName: 'Razonamiento de Aurene' },
  btnSabiduria: { id: 'btnSabiduria', itemId: '96221', itemName: 'Sabiduría de Aurene' },
  btnColmillo: { id: 'btnColmillo', itemId: '95675', itemName: 'Colmillo de Aurene' },
  btnMirada: { id: 'btnMirada', itemId: '97165', itemName: 'Mirada de Aurene' },
  btnEscama: { id: 'btnEscama', itemId: '96028', itemName: 'Escama de Aurene' },
  btnAliento: { id: 'btnAliento', itemId: '97099', itemName: 'Aliento de Aurene' },
  btnVoz: { id: 'btnVoz', itemId: '97783', itemName: 'Voz de Aurene' },
  btnMordisco: { id: 'btnMordisco', itemId: '96356', itemName: 'Mordisco de Aurene' },
  btnPeso: { id: 'btnPeso', itemId: '95684', itemName: 'Peso de Aurene' },
  btnVuelo: { id: 'btnVuelo', itemId: '97590', itemName: 'Vuelo de Aurene' },
  btnPersuasion: { id: 'btnPersuasion', itemId: '97377', itemName: 'Persuasión de Aurene' },
  btnAla: { id: 'btnAla', itemId: '97077', itemName: 'Ala de Aurene' },
  btnReflexion: { id: 'btnReflexion', itemId: '96652', itemName: 'Reflexión de Aurene' }
};

const customPriceTexts3 = [
  { name: 'Don de la exploración', display: 'Recompensa por completar mapas', keywords: ['exploraci'] },
  { name: 'Don de la batalla', display: 'Recompensa por completar la ruta del don de la batalla en WvW', keywords: ['don de la batalla'] },
  { name: 'Esquirla de hematites', display: 'Se compra en la forja mística', keywords: ['hematites'] },
  { name: 'Esquirla de obsidiana', display: 'Se compra por karma con NPC', keywords: ['obsidiana'] }
];

window.appThirdGen = new LegendaryCraftingBase({
  getItemById: id => getLegendary3GenItem(parseInt(id)),
  items: Object.values(LEGENDARY_ITEMS_3GEN),
  createIngredientTree: createIngredientTree3,
  isBasicMaterial: isBasic3GenMaterial,
  quickLoadButtons: quickLoadButtons3,
  customPriceTexts: customPriceTexts3,
    elementIds: {
      craftingTree: 'craftingTreeThird',
      skeleton: 'craftingTreeSkeletonThird',
      summary: 'summaryThird',
      summaryContent: 'summaryContentThird',
      loadTree: 'loadTreeThird',
      clearCache: 'clearCacheThird',
      itemIdInput: 'itemIdThird',
      itemNameInput: 'itemNameThird'
    }
  });

// Expose legendary items data globally for other modules
window.LEGENDARY_ITEMS = LEGENDARY_ITEMS;
window.LEGENDARY_ITEMS_3GEN = LEGENDARY_ITEMS_3GEN;
/**
 * Global container with all legendary item datasets. Other modules should
 * reference this object instead of importing the constants directly.
 */
window.LegendaryData = {
  LEGENDARY_ITEMS,
  LEGENDARY_ITEMS_3GEN,
  BASIC_MATERIALS,
  BASIC_MATERIALS_3GEN
};
