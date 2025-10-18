# Notas de agregadores de datos

## Utilidades compartidas (bundle-fractales.js y bundle-forja-mistica.js)

- `async fetchIconsFor(ids = [])`
  - **Entrada:** array de IDs numéricos (se ignoran arrays vacíos).
  - **Proceso:** llama a `fetchWithRetry` contra la API oficial `https://api.guildwars2.com/v2/items?ids=...&lang=es`.
    - Deserializa la respuesta JSON y, por cada elemento con `id`, guarda `item.icon` en `iconCache[id]` y `item.rarity` en `rarityCache[id]`.
  - **Salida:** `Promise<void>`; no devuelve datos explícitos y silencia excepciones (catch vacío).
  - **Efecto secundario:** rellena los caches en memoria `iconCache` y `rarityCache` compartidos entre Fractales y Forja Mística.

- `async fetchItemPrices(ids = [])`
  - **Entrada:** array de IDs numéricos. Si es `null`/`undefined` o vacío devuelve inmediatamente `new Map()`.
  - **Proceso:** consulta la API de DataWars (`https://api.datawars2.ie/.../items/csv`) solicitando los campos `id,buy_price,sell_price`.
    - Convierte el CSV a texto, separa cabecera y filas, localiza los índices `id`, `buy_price`, `sell_price` y construye un `Map<number, { buy_price: number, sell_price: number }>`.
  - **Salida:** `Promise<Map<number, { buy_price: number, sell_price: number }>>`. Ante errores devuelve `new Map()`.
  - **Orden de resolución:** primero DataWars para precios; no hay fallback a la API oficial.

- `iconCache` y `rarityCache`
  - Objetos simples (`Record<number, string>`) rellenados por `fetchIconsFor`.
  - Se exponen junto con las funciones anteriores como `window.FractalesUtils = { fetchIconsFor, fetchItemPrices, iconCache, rarityCache }` cuando existe `window`.

## Integración en `fractales-gold.html`

- El script inline obtiene `const utils = window.FractalesUtils;` y espera:
  - Que `fetchItemPrices` devuelva un `Map`. Si recibe otro tipo, normaliza convirtiendo un objeto plano `{ [id]: priceEntry }` a `Map` antes de leer `.get(id)`.
  - Entradas con claves numéricas (`75919`, `73248`) y propiedades `buy_price`/`sell_price` numéricas para poblar los valores de compra/venta.
  - `fetchIconsFor` recibe los IDs de `window.FractalesGoldUI.ICON_ID_MAP` y se usa solo por sus efectos secundarios (pre-cargar iconos y rarezas en los caches compartidos).
- Dependencias adicionales:
  - La UI dinámica se obtiene de `window.FractalesGoldUI` (exportada por `bundle-fractales.js`).
  - Mensajería de error opcional mediante `window.StorageUtils?.showToast`.

## Integración en `forja-mistica.html`

- `bundle-forja-mistica.js` invoca internamente `fetchItemPrices` y `fetchIconsFor` en `renderTablaForja` y `renderTablaLodestones` durante `DOMContentLoaded`.
  - Se espera que `fetchItemPrices` devuelva un `Map` válido; sus entradas se consultan con `.get(id)` para obtener `buy_price`/`sell_price`.
  - Tras poblar los caches con `fetchIconsFor`, los iconos se extraen directamente de `iconCache[id]` al renderizar cada celda (no se consulta a través de `window.FractalesUtils`).
- Dependencias adicionales:
  - Usa `window.formatGoldColored` para formatear valores (`formatValueWithMissing`).
  - Aplica `PRICE_OVERRIDES` internos para manejar materiales sin precio en el bazar.

## Resumen del flujo de datos

1. La página solicita precios a DataWars mediante `fetchItemPrices`. El resultado se entrega como `Map` y sirve de única fuente para cálculos económicos.
2. En paralelo, `fetchIconsFor` consulta la API oficial de Guild Wars 2 para enriquecer `iconCache` y `rarityCache` con iconos/rareza de los IDs solicitados.
3. Las tablas y gráficos (Fractales/Forja) consumen ese `Map` y los caches poblados para pintar la UI y calcular profits.

Estos contratos deben mantenerse al agregar nuevas vistas: los consumidores esperan un `Map` y efectos secundarios sobre los caches compartidos expuestos vía `window.FractalesUtils`.
