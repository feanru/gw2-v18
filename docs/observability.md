# Observabilidad y métricas

La plataforma expone métricas operativas en formato Prometheus para facilitar la observación en tiempo real del backend, Redis y el service worker. Este documento resume los recursos disponibles, la integración con Grafana y los procedimientos de verificación.

## Endpoint `/metrics`

* Ruta: `GET /metrics`
* Formato: `text/plain; version=0.0.4`
* Respuesta: métricas con prefijo `gw2_` agrupadas por familia (`responses`, `js_errors`, `mongo`, `redis`, `service_worker`, `system`).
* Autenticación: no requiere cabeceras especiales; se recomienda proteger el endpoint a nivel de infraestructura.

Entre las métricas más relevantes se encuentran:

| Métrica | Tipo | Descripción |
| --- | --- | --- |
| `gw2_api_responses_total` | gauge | Total de respuestas servidas en la ventana del dashboard.
| `gw2_api_responses_stale_ratio` | gauge | Proporción de respuestas stale respecto del total.
| `gw2_api_latency_p95_ms` | gauge | Latencia p95 (ms) de las peticiones JSON.
| `gw2_js_errors_per_minute` | gauge | Tasa de errores JS en la ventana de telemetría.
| `gw2_mongo_index_size_bytes{collection="items"}` | gauge | Tamaño total de índices por colección.
| `gw2_redis_up` | gauge | Estado de conectividad de Redis (1 disponible, 0 inaccesible).
| `gw2_service_worker_cache_total{type="hit"}` | gauge | Conteo acumulado de aciertos reportados por el service worker.
| `gw2_service_worker_cache_last_updated_timestamp` | gauge | Fecha de la última actualización de métricas del worker (timestamp Unix).
| `gw2_system_load_average{window="5m"}` | gauge | Carga promedio del sistema operativo (os.loadavg).

Cada respuesta incluye el identificador de traza (`X-Trace-Id`) para facilitar la correlación con los logs del backend y con las respuestas JSON consumidas por el frontend.

## Integración con Grafana

1. **Configuración del datasource**
   * Tipo: *Prometheus*.
   * URL de scraping: apuntar al endpoint `/metrics` expuesto por el backend (ej. `http://api-internal:3300/metrics`).
   * Intervalo de scraping sugerido: 30 s.

2. **Paneles recomendados**
   * **Salud de la API**
     * Gráfico de líneas para `gw2_api_latency_p95_ms` y `gw2_api_latency_p99_ms`.
     * Panel de barras apiladas con `sum by (collection) (gw2_ingestion_failures_collection_24h)`.
     * Indicador tipo *stat* con `gw2_api_responses_stale_ratio` (umbral de alerta > 0.1).
   * **Errores de frontend**
     * Serie de tiempo con `gw2_js_errors_per_minute`.
     * Tabla con `topk(5, gw2_js_errors_total)` usando etiquetas de fingerprint (opcional si se enriquece en Prometheus).
   * **Persistencia**
     * Gráfico comparativo de `gw2_mongo_index_size_bytes` por colección.
     * Indicador de `gw2_redis_up` y `gw2_redis_ping_latency_ms`.
   * **Service worker**
     * Pie chart con los contadores `gw2_service_worker_cache_total{type=...}`.
     * Serie de tiempo con `gw2_service_worker_cache_last_updated_timestamp` (en formato `time()` para detectar retrasos).

3. **Alertas sugeridas**
   * *Stale responses*: disparar si `gw2_api_responses_stale_ratio > 0.1` durante 5 minutos.
   * *Errores JS*: disparar si `gw2_js_errors_per_minute > 5` durante 10 minutos.
   * *Footprint Mongo*: alerta cuando `gw2_mongo_index_threshold_exceeded{collection=~"items|prices|recipes"} == 1`.
   * *Latencia Redis*: aviso si `gw2_redis_ping_latency_ms > 100` durante 5 minutos o `gw2_redis_up == 0`.
   * *Service worker obsoleto*: notificar si `time() - gw2_service_worker_cache_last_updated_timestamp > 900`.

Puede exportarse un dashboard con los paneles anteriores y versionarlo en `docs/grafana/` (no incluido en este cambio). Al compartir el dashboard incluir el datasource por nombre (`Prometheus - Backend`).

## Procedimientos de verificación

### Comprobación rápida

1. Iniciar el backend en el entorno deseado.
2. Ejecutar el script `scripts/check-metrics.mjs`:

   ```bash
   node scripts/check-metrics.mjs --url http://localhost:3300/metrics
   ```

   El script valida la presencia de métricas críticas (latencia, errores JS, Redis y service worker) y devuelve un resumen legible. El proceso termina con código de salida distinto de cero si falta alguna métrica esencial.

3. Revisar manualmente en el navegador o con `curl`:

   ```bash
   curl -H "Accept: text/plain" http://localhost:3300/metrics | head
   ```

   Confirmar que los valores coinciden con el dashboard `/admin/dashboard` y que el encabezado `X-Trace-Id` está presente.

### Validación de Grafana

1. Crear o actualizar el datasource Prometheus apuntando al endpoint descrito.
2. Importar (o actualizar) el dashboard recomendado y verificar que los paneles reciben datos.
3. Forzar escenarios de prueba:
   * Simular errores JS (ejecutar `tests/api/admin-dashboard-metrics.test.js` o el colector de pruebas) y comprobar la variación de `gw2_js_errors_per_minute`.
   * Deshabilitar temporalmente Redis para observar el cambio en `gw2_redis_up`.
4. Revisar que las alertas configuradas cambien de estado acorde a los umbrales definidos.

### Auditoría periódica

* Ejecutar semanalmente `node scripts/check-metrics.mjs` desde CI.
* Comparar métricas clave contra el historial del dashboard para detectar anomalías.
* Documentar en el runbook cualquier alerta disparada y su resolución.

## Referencias

* Dashboard administrativo: `GET /admin/dashboard`
* Script de diagnóstico: [`scripts/check-metrics.mjs`](../scripts/check-metrics.mjs)
* Módulo de métricas: [`backend/api/metrics.js`](../backend/api/metrics.js)
