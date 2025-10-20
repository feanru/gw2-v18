# Flujo de despliegue CDN

Este documento resume cómo publicar los bundles versionados en una CDN dedicada y cómo invalidar de forma selectiva los activos tras cada build.

## Configuración previa

1. Define la variable de entorno `CDN_BASE_URL` tanto en el entorno de build como en el origen Nginx.
   - Debe incluir el esquema (`https://`) y no llevar barra final. Ejemplo: `https://cdn.ejemplo.com`.
   - El runtime (`/runtime-env.js`) expone este valor en `window.__RUNTIME_CONFIG__.CDN_BASE_URL` para que el frontend pueda construir URLs absolutas cuando sea necesario.
2. Actualiza la configuración del proveedor (Cloudflare, Fastly, etc.) para que la CDN resuelva hacia el origen Nginx que sirve `/dist/<versión>/js/*` con caché de larga duración.
3. Asegúrate de que el certificado TLS cubre el dominio CDN.

## Despliegue de artefactos

1. Ejecuta `npm run build` para generar `dist/<versión>/js/*` y el `dist/manifest.json` con los mapeos canónicos.
2. Publica el directorio `dist/` en el bucket/origen asociado a la CDN.
3. Verifica que los HTML apuntan a rutas versionadas (la prueba `tests/ensure-versioned-assets.mjs` lo valida automáticamente).

## Invalidación selectiva

1. Exporta las credenciales Cloudflare: `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_TOKEN` y el dominio `CDN_BASE_URL`.
2. Ejecuta `npm run purge:cdn` después de subir los artefactos. El script `scripts/purge-cdn.js` lee `dist/manifest.json`, construye las URLs absolutas en la CDN y purga únicamente esos archivos (se incluyen las rutas versionadas y el `manifest.json`).
3. Si `SKIP_PURGE_CDN=1`, el paso se omite. Cualquier error termina el proceso con código distinto de cero.

## Verificación

- `npm test` ejecuta `tests/cdn-cache.test.mjs`, que inicia una CDN simulada y realiza `fetch` a cada recurso versionado verificando:
  - Respuesta `200` (sin 404 inesperados).
  - Encabezado `Cache-Control: public, max-age=31536000, immutable`.
  - Encabezado `ETag` consistente con el contenido.
- Los endpoints de dashboard (`buildDashboardSnapshot`) ahora reportan métricas de **TTFB** y **tamaño de payload** para auditar el impacto del CDN.

Con estos pasos se asegura que cada despliegue invalida únicamente los activos cambiados, manteniendo la caché de versiones anteriores estable y medible.
