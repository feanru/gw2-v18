# Legendary Crafting Data

This repository contains the scripts used by the site. Source files are kept in `src/js` and the distributable, minified versions live under `/dist/<versión>/js/`, donde `<versión>` corresponde a la secuencia de despliegues.

Run `npm run build` to regenerate the bundles. Before compiling it removes any previous output in `dist/` to avoid stale assets, calculates the next patch version (for example `0.0.2` after `0.0.1`) and sets `NEXT_VERSION` so Rollup writes each file under `src/js` into `/dist/<versión>/js/<bundle>.min.js`. Once finished it runs a CDN purge so clients receive the new routes and updates `dist/manifest.json` to map the canonical `/dist/js/<bundle>.min.js` entries to the active version directory.

### Build y despliegue

1. Ejecuta `npm run build` para generar los bundles. Este comando limpia `dist/js` y `dist/manifest.json` al inicio, calcula `APP_VERSION` y compila los archivos.
2. Al finalizar, el script `postbuild` invoca `scripts/purge-cdn.js` para invalidar caches de Cloudflare. Define `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_TOKEN` en el entorno para que la operación tenga éxito.
3. Publica el contenido de `dist/` en tu servidor o CDN. Los bundles quedan ubicados en un directorio versionado (`dist/<versión>/js/`) y `dist/manifest.json` enlaza los nombres canónicos con esa ruta. Puedes servirlos con caché de larga duración porque cada despliegue genera una versión nueva.
4. Si algún HTML conserva referencias directas a `/dist/js/<bundle>.min.js`, la verificación `tests/ensure-versioned-assets.mjs` fallará durante la suite de pruebas. Esto protege al build de publicar rutas sin versión que el CDN no podría invalidar correctamente.

Include the bundles from `/dist/js/` in your HTML pages. Usa los nombres canónicos sin hash; `dist/manifest.json` indica qué directorio versionado está activo y `scripts/update-html.js` reescribe las rutas durante el build:

```html
<script src="/dist/js/bundle-legendary.min.js"></script>
```

Cuando despliegas, el manifest resolverá esta ruta a algo como `/dist/0.0.1/js/bundle-legendary.min.js`.

## Pruebas

Instala las dependencias del proyecto y ejecuta la suite con:

```bash
npm install
npm test
```

El comando `npm run lint:domains` valida que el runtime y los workers no
introduzcan dominios externos fuera de la lista permitida.

El comando `npm test` compila los paquetes necesarios y después ejecuta los scripts ubicados en `tests/`. Entre ellos se encuentra `recipeTree.test.js`, que inyecta clientes simulados de MongoDB y Redis para verificar que la primera petición obtenga los datos desde Mongo y la segunda desde la caché de Redis. También se ejecuta `tests/check-assets.mjs`, que recorre cada HTML de `dist/` y valida que los `<script src>` y las llamadas `import()` apunten a archivos existentes.

Además, `tests/ensure-versioned-assets.mjs` analiza todos los HTML del repositorio y compara las rutas encontradas con el contenido de `dist/manifest.json`. Si detecta un `<script>` o una llamada `import()` que apunte a `/dist/js/<bundle>.min.js` (sin el prefijo de versión), la prueba finaliza con error para obligarte a reescribir la referencia mediante el manifest.

Las pruebas sólo requieren Node.js y las dependencias instaladas (`mongodb` y `redis`); no es necesario levantar instancias reales de estas bases de datos, ya que se usan mocks.

### Workers de agregación

El generador de agregados ejecuta la parte intensiva de la consulta dentro de un `Worker` de Node.js. Puedes limitar la memoria disponible del proceso hijo mediante las variables de entorno:

- `AGGREGATE_MAX_OLD_MB`: asigna el valor para `resourceLimits.maxOldGenerationSizeMb`. Si no se define, se utiliza el límite predeterminado del runtime.
- `AGGREGATE_MAX_YOUNG_MB`: asigna el valor para `resourceLimits.maxYoungGenerationSizeMb`. Sin esta variable se aplican los valores por defecto de Node.js.

Ambos valores aceptan números enteros en megabytes. Cuando no se indican, el worker funciona con los límites estándar del motor V8.

## Despliegue

Los archivos HTML referencian recursos almacenados en directorios versionados (`/dist/<versión>/js/`) y pueden servirse con encabezados de caché agresivos (por ejemplo `Cache-Control: public, max-age=31536000, immutable`). Tras cada despliegue, invalida las cachés de la CDN o de Cloudflare para que los HTML apunten al nuevo directorio generado.

### Checklist de verificación previa al release

1. **Probar `/api/items/bundle`.** Ejecuta `curl -i https://<host>/api/items/bundle?ids=19721,19722` (sustituye `<host>` por el dominio del entorno). Asegúrate de que responde con HTTP `200` y que las cabeceras incluyen `Content-Type: application/json; charset=utf-8` y `X-Data-Source`. Si la respuesta devuelve un `400`, confirma que el cuerpo sigue siendo JSON válido con un `meta.traceId` poblado.
2. **Confirmar cabeceras en caché y API.** Repite la llamada anterior con `-H 'Accept-Language: en'` y valida que el proxy mantiene `Cache-Control` y `Content-Type` sin degradar a `text/html`. Esto previene que el fallback SPA se active en producción.
3. **Supervisar `window.__bundleFallbacks__`.** Con la aplicación cargada en el navegador (entorno de pruebas), abre la consola y ejecuta `window.__bundleFallbacks__`. Tras un despliegue limpio el arreglo debe estar vacío o contener únicamente entradas antiguas; si aparecen IDs nuevos significa que el frontend tuvo que recurrir al PHP.
4. **Vigilar avisos de `requestManager`.** En la misma sesión de DevTools, filtra los logs por `[requestManager]`. Cualquier mensaje nuevo sobre `unexpected content-type` o `official API fallback` indica que la API moderna está devolviendo HTML o errores y debe corregirse antes de cerrar el release.
5. **Revisar las métricas de impacto.** Ejecuta `node scripts/generate-impact-report.mjs` y contrasta los resultados con los umbrales descritos en [`docs/observability/impact-metrics.md`](docs/observability/impact-metrics.md). Si aumentan los errores o los Core Web Vitals empeoran, detén el despliegue hasta investigar la causa.

### Política de caché

- Los bundles y workers alojados bajo rutas versionadas (`/dist/<versión>/js/`) se sirven con `Cache-Control: public, max-age=31536000, immutable` a través de `nginx.conf`. Al cambiar la versión se genera un nuevo directorio, por lo que las rutas antiguas pueden permanecer en caché indefinidamente.
- El archivo `/runtime-env.js` define variables de entorno específicas del despliegue y se entrega con `Cache-Control: no-store, no-cache, must-revalidate` para que cada petición obtenga el valor más reciente.
- Otros recursos dinámicos (por ejemplo los endpoints bajo `/api/`) mantienen la configuración existente sin caché explícita.

`dist/manifest.json` funciona como tabla de búsqueda entre las rutas canónicas (`/dist/js/*.min.js`) y las rutas efectivas (`/dist/<versión>/js/*.min.js`). Durante el despliegue puedes leer este archivo para reescribir las rutas en tus plantillas o HTML estáticos. Un ejemplo en Node.js sería:

```js
import { readFileSync } from 'fs';

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const legendaryBundle = manifest['/dist/js/bundle-legendary.min.js'];

// Reemplaza la ruta canónica por la versionada antes de subir el HTML
html = html.replace('/dist/js/bundle-legendary.min.js', legendaryBundle);
```

También puedes delegar esta tarea a `scripts/update-html.js`, que se ejecuta al final de `npm run build` y reescribe los HTML generados con las rutas versionadas presentes en el manifest.

After loading the canonical `/dist/js/bundle-legendary.min.js` (resuelto mediante `dist/manifest.json` a la versión activa) a global object `window.LegendaryData` becomes available with the following properties:

- `LEGENDARY_ITEMS` – mapping of first generation legendary items.
- `LEGENDARY_ITEMS_3GEN` – mapping of third generation legendary weapons.
- `BASIC_MATERIALS` – shared basic material definitions for Gen 1 items.
- `BASIC_MATERIALS_3GEN` – basic material definitions for Gen 3 items.

Example usage:

```html
<script src="/dist/js/bundle-legendary.min.js"></script>
<script>
  const { LEGENDARY_ITEMS } = window.LegendaryData;
  console.log(Object.keys(LEGENDARY_ITEMS));
</script>
```

Modules such as `dones.js` rely on this object to fetch legendary item information. Future scripts should also consume data from `window.LegendaryData` to ensure consistency across the project.

### Bag crafting data flow

`bundle-bags.js` reconstruye el árbol de ingredientes a partir de los datos manuales definidos en `src/js/data/bags32.js`, pero la información de ítems y precios proviene siempre de `RecipeService`. Antes de generar el árbol, `BagCraftingApp` recorre el `manualRoot` (y sus variantes) para obtener la lista completa de IDs y emite una única llamada a `RecipeService.getItemBundles(ids)`. El resultado se almacena en una caché local que rellena `itemDetailsCache` y `priceCache`, de modo que los nodos reutilizan los datos ya resueltos en lugar de llamar a `getItemDetails`/`getPrice` por separado.

Si algún bundle llega sin información de mercado, el árbol usa `getPrice` como *fallback* para mantener la coherencia de precios. El worker de costos sigue leyendo el árbol normalizado para calcular totales. Cuando sea necesario añadir nuevas recetas o variantes, mantén este flujo y obtén la información desde `RecipeService` (o desde `window.LegendaryData` cuando aplique) para conservar una única fuente de verdad dentro del sitio.

## Notas de refactorización

- Todas las páginas HTML ahora cargan scripts desde `/dist/js/` en lugar de `js/`.
- Los archivos fuente originales se movieron a `src/js`.
- Varias funciones de `items-core.js` se exponen en `window` para seguir siendo accesibles sin módulos.

## Concurrencia

- Las comparativas cargadas desde la URL se procesan en paralelo usando `Promise.allSettled` en lotes de hasta 10 peticiones.
- Los componentes de ítems legendarios se generan concurrentemente mediante `Promise.allSettled`.
- No se añadieron nuevas dependencias; las APIs externas pueden limitar el número máximo de solicitudes simultáneas.

## Configuración del backend

El proyecto incluye un pequeño backend en PHP ubicado en `backend/` que se encarga de guardar favoritos, comparaciones y la información de la sesión.

> **Aviso**
> Este proyecto está configurado para ejecutarse en un servidor real.
> Revisa las variables `DB_HOST`, `DB_NAME`, `DB_USER` y `DB_PASS` en `.env` antes de desplegar.
> El backend ya no está pensado sólo para GitHub Pages.

### Crear la base de datos

1. Crea una base de datos en tu servidor MySQL (por defecto se usa `gw2db`).
2. Ejecuta el script `setup.sql` para crear las tablas necesarias:

   ```bash
   mysql -u <usuario> -p <nombre_db> < backend/setup.sql
   ```

### Configurar credenciales

`backend/config.php` lee las credenciales de conexión mediante las variables de entorno `DB_HOST`, `DB_NAME`, `DB_USER` y `DB_PASS`. Si no existen, se emplean los valores predeterminados definidos en el archivo.

Puedes definir estas variables de dos formas:

1. Exportándolas manualmente en tu terminal:

   ```bash
   export DB_HOST=localhost
   export DB_NAME=gw2db
   export DB_USER=root
   export DB_PASS=
   export GOOGLE_CLIENT_ID=<tu-id-google>
   export GOOGLE_CLIENT_SECRET=<tu-secreto-google>
   export DISCORD_CLIENT_ID=<tu-id-discord>
   export DISCORD_CLIENT_SECRET=<tu-secreto-discord>
   export OAUTH_REDIRECT_URI=https://gw2item.com/backend/oauth_callback.php
   ```



Las variables `API_BASE_URL`, `LANG` y `MARKET_CSV_URL` permiten
personalizar las URL de la API y el idioma por defecto. `GW2_API_KEY`
se usará para acceder a endpoints que requieren autenticación.

Si necesitas usar otra ubicación para este archivo, define la variable
de entorno `ENV_PATH` con la ruta al `.env`. `backend/env.php` la
utilizará antes de comprobar las rutas predeterminadas.

### Configurar DB_HOST, DB_NAME, DB_USER y DB_PASS en un servidor real

Cuando despliegues el backend fuera de GitHub Pages necesitarás que la
conexión a la base de datos apunte a tu servidor. La ruta indicada por
`ENV_PATH` (o el propio `.env`) debe incluir las credenciales reales:

```env
DB_HOST=<ip-o-hostname>
DB_NAME=<nombre_db>
DB_USER=<usuario_db>
DB_PASS=<password_db>
```


Solo debes actualizar `DB_PASS` con la contrase\xc3\xb1a correspondiente si
clonas el proyecto para usarlo en otro entorno. Con ello el backend quedar\xc3\xa1
listo para ejecutarse en un servidor real y no exclusivamente desde GitHub Pages.

Si estos valores no se establecen correctamente, `backend/config.php`
devolverá `{"error":"Database connection failed"}` al no poder abrir la
conexión.

Asegúrate de que `OAUTH_REDIRECT_URI` apunte a la ubicación pública de `oauth_callback.php` y que el resto de valores coincidan con los configurados en las consolas de desarrolladores de Google y Discord.

`GOOGLE_CLIENT_ID` ahora corresponde al nuevo identificador de OAuth y `OAUTH_REDIRECT_URI` debe apuntar a la URL pública donde se encuentra `oauth_callback.php`.

Para que la cookie de sesión pueda marcarse como `secure`, ejecuta el backend bajo HTTPS. `oauth_callback.php` utilizará esa opción automáticamente cuando la variable `$_SERVER['HTTPS']` esté definida.

### Endpoints disponibles

Dentro de `backend/api/` existen tres endpoints principales que el frontend consume mediante `fetch`:

- **`user.php`** – Devuelve la información del usuario autenticado.
- **`favorites.php`** – Permite listar, añadir o eliminar IDs de ítems favoritos usando los métodos `GET`, `POST` y `DELETE` respectivamente.
- **`comparisons.php`** – Gestiona las comparativas guardadas con la misma convención de métodos HTTP.

### Respuestas JSON ante errores inesperados

Todos los scripts que sirven bajo `backend/api/` cargan `response.php`, que ahora define manejadores globales para excepciones y
errores de PHP. Ante cualquier `Throwable` no controlado o `trigger_error`, el backend responde con `json_fail(500, 'error_unexpected', 'Unexpected error')`, reutilizando el `meta` de la petición (incluido el `traceId`) y nunca imprime HTML. Los
endpoints de agregación (`dataBundle.php`, `itemBundle.php`, `itemDetails.php`, `favorites.php`, etc.) encapsulan su lógica en
`try/catch` para reenviar los fallos con códigos específicos y añadir el `source` calculado a las respuestas.

Todos ellos requieren que el navegador envíe la cookie `session_id` generada al autenticarse con `auth.php` y `oauth_callback.php`. Los módulos de `src/js/storageUtils.js` y `src/js/cuenta.js` muestran ejemplos de cómo se consumen desde el frontend.

### Troubleshooting
Si las variables de entorno no se cargan correctamente, comprueba que `ENV_PATH` apunte a la ruta completa de tu archivo `.env`. Puedes exportarla en la terminal:

```bash
export ENV_PATH=/ruta/completa/a/.env
```

Para verificar que el archivo se ha leído, ejecuta un pequeño script PHP:

```php
var_dump(getenv('DB_HOST'));
```

Debería mostrar el host definido en tu `.env`.
