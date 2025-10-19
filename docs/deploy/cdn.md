# Flujo de despliegue con CDN

Esta guía describe cómo activar la entrega de assets estáticos desde un dominio CDN dedicado sin perder el control de las rutas versionadas generadas por el build.

## Configuración del origen (Nginx)

1. Define la variable de entorno `CDN_BASE_URL` apuntando al dominio público de la CDN (por ejemplo `https://static.example.com`).
2. Reinicia Nginx con la variable exportada. El bloque `http` lee `CDN_BASE_URL` y la inyecta en la política CSP para permitir que navegadores carguen scripts, estilos, fuentes e imágenes desde ese dominio.
3. Cuando el valor está presente, las peticiones directas a `/dist/<versión>/js/*` reciben un `302` hacia la CDN. Esto mantiene la ruta versionada y evita servir los bundles desde el origen por accidente. La CDN debe responder esos recursos con `Cache-Control: public, s-maxage=3600, stale-while-revalidate=60` para equilibrar frescura y disponibilidad.

> **Nota:** Los assets se siguen construyendo en `dist/`. Asegúrate de sincronizar ese directorio con la CDN antes de purgarla para no exponer rutas inexistentes.

## Runtime dinámico (`/runtime-env.js`)

El bootstrap del runtime añade ahora la clave `CDN_BASE_URL` al objeto `window.__RUNTIME_CONFIG__`. Puedes sobreescribirla desde configuraciones seguras o inyectarla antes de cargar el script. El valor se normaliza (elimina espacios y la barra final) para que los clientes puedan concatenar rutas versionadas sin obtener dobles barras.

## Purga selectiva

`scripts/purge-cdn.js` lee `dist/manifest.json` y construye la lista de rutas a invalidar combinándolas con `CDN_BASE_URL`. El script envía lotes de hasta 30 URLs a la API de Cloudflare e incluye artefactos críticos como `/runtime-env.js`, `service-worker.min.js` y `dist/manifest.json`. Si `CDN_BASE_URL` no está definido o el manifest no existe, el proceso se aborta para evitar purgas incompletas.

Ejemplo de ejecución tras un build:

```bash
CDN_BASE_URL=https://static.example.com \
CLOUDFLARE_ZONE_ID=xxxxx \
CLOUDFLARE_TOKEN=yyyyy \
npm run purge:cdn
```

## Verificación automática

Se añadió `tests/cdn-cache.test.mjs`, que levanta un servidor HTTP temporal con encabezados equivalentes a la CDN y usa `fetch` para solicitar cada ruta versionada del manifest. El test comprueba:

- Respuesta `200` para cada asset.
- Encabezado `Cache-Control` con `public`, `s-maxage=3600` y `stale-while-revalidate=60`.
- Presencia de `ETag`.

Incluye el test en tu pipeline (`npm test`) para detectar rutas faltantes o encabezados incorrectos antes de desplegar.
