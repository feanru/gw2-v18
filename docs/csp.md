# Política de Content Security Policy

La cabecera CSP definida en `nginx.conf` se entrega ahora como
`Content-Security-Policy` para bloquear de inmediato los orígenes no
permitidos. Si un despliegue requiere un periodo de observación, cambia
temporalmente la directiva a
`add_header Content-Security-Policy-Report-Only $csp always;` y vuelve al
modo de aplicación una vez que el monitoreo sea satisfactorio. Mientras
la política esté en modo de sólo reporte se publicarán los avisos en
`/csp-report` usando los encabezados `Report-To` y `Reporting-Endpoints`.

## Flujo de adopción

1. Para despliegues nuevos activa primero el modo "report-only", revisa
   el log `/var/log/nginx/csp-report.log` junto con las advertencias de
   consola y corrige los hallazgos.
2. Una vez validada la ventana de observación, vuelve a habilitar la
   cabecera `Content-Security-Policy` y purga las cachés intermedias con
   `npm run purge:cdn` para evitar encabezados obsoletos.
3. Mantén la lista de fuentes tan reducida como sea posible. Actualmente
   `connect-src` está limitada a `'self'`, Google Analytics y Google Tag
   Manager.

El cambio de cabecera debe formar parte del siguiente despliegue para
que la política empiece a bloquear peticiones directamente.

## Lista de dominios permitidos

La configuración de runtime y los workers sólo pueden depender de una
lista cerrada de dominios. Ejecuta `npm run lint:domains` para comprobar
que no se introducen endpoints externos adicionales. El script valida
`runtime-env.js`, `src/js/config.js` y
`src/js/workers/ingredientTreeWorker.js`.
