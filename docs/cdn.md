# Directrices CDN

## Compresión HTTP

- La configuración de `nginx.conf` habilita `gzip` (nivel 6) y `brotli` (nivel 5) para respuestas JSON, JavaScript, CSS y SVG.
- En despliegues detrás de CDN (CloudFront, Cloudflare, Fastly):
  - Asegura que la CDN permita **passthrough** de encabezados `Content-Encoding` enviados por Nginx.
  - Activa la compresión del proveedor solo cuando no interfiera con la negociación `brotli`/`gzip` del origen (modo "respect existing compression").
  - Purga o invalida el caché tras cualquier cambio en esta configuración para evitar servir recursos mezclados.
- Verifica desde la CDN que las respuestas `/api/*` y `/dist/*` reporten `Content-Encoding: br` o `gzip` según soporte del cliente.
- Para monitorizar el tamaño efectivo de los payloads, utiliza `node scripts/measure-payloads.mjs --url /api/items/1001/aggregate --url /api/aggregate/bundle?ids=123,456` contra el entorno deseado.
