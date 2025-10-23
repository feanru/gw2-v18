# Métricas de impacto y umbrales operativos

Este documento resume los indicadores que usamos para medir el impacto visible de la API y del frontend. Los valores se derivan
de `/admin/dashboard`, del endpoint Prometheus (`/metrics`) y de los eventos de telemetría enviados por el cliente mediante
[`web-vitals`](https://github.com/GoogleChrome/web-vitals).

## Objetivos principales

* Mantener la latencia p95 del endpoint `aggregate` por debajo de **2 000 ms** y la p99 por debajo de **3 000 ms**.
* Mantener la tasa de respuestas erróneas (HTTP 5xx) en **< 1 %** por endpoint.
* Mantener la proporción de respuestas stale en **< 10 %** y la tasa de aciertos de caché (`cacheHitPercentage`) por encima de
  **80 %**.
* Limitar los errores de JavaScript a **≤ 5 eventos por minuto** en la ventana de observación.
* Cumplir con los umbrales recomendados de Core Web Vitals:
  * **LCP**: p75 ≤ 2.5 s
  * **CLS**: p75 ≤ 0.1
  * **INP**: p75 ≤ 200 ms
  * **FID** (para navegadores que aún lo reportan): p75 ≤ 100 ms

Estos objetivos son los mínimos aceptables; cualquier desviación debe discutirse antes de promocionar un despliegue a producción.

## Interpretación de `/admin/dashboard`

La respuesta incluye un bloque `endpoints` con métricas agregadas por nombre de endpoint. Cada entrada expone:

* `responses.total`, `responses.errorPercentage`, `responses.stalePercentage`
* Percentiles de latencia (`latency.p50/p95/p99`) y de tamaño (`payload.p50Bytes/p95Bytes/p99Bytes`)
* Estadísticas de caché (`cache.hitPercentage`, `cache.stalePercentage`)

Compara estos valores contra los umbrales anteriores. Si `errorPercentage` supera el 1 % o `stalePercentage` el 10 %, se debe
investigar la causa (normalmente builds fallidos, problemas de CDN o errores de origen).

El bloque `webVitals.metrics` resume las muestras recopiladas desde el frontend. Los valores se expresan en milisegundos excepto
CLS, que es adimensional. Para visualizarlos en Grafana puedes consumir las métricas `gw2_web_vital_*`.

## Prometheus / Grafana

Las siguientes métricas agregadas están disponibles por endpoint (label `endpoint`):

| Métrica | Descripción | Umbral |
| --- | --- | --- |
| `gw2_api_endpoint_latency_p95_ms` | Latencia p95 por endpoint | < 2 000 ms (aggregate) |
| `gw2_api_endpoint_error_percentage` | Porcentaje de respuestas HTTP 5xx | < 1 % |
| `gw2_api_endpoint_cache_hit_percentage` | Porcentaje de aciertos de caché | ≥ 80 % |
| `gw2_api_endpoint_stale_percentage` | Porcentaje de respuestas stale | < 10 % |
| `gw2_web_vital_value{metric="LCP",stat="p75"}` | p75 de LCP en milisegundos | ≤ 2 500 ms |
| `gw2_web_vital_good_percentage{metric="CLS"}` | Porcentaje de CLS en rango "bueno" | ≥ 75 % |

Configura alertas cuando los valores superen los umbrales durante al menos 5 minutos. En dashboards de Grafana recomendamos un
panel para cada endpoint crítico y otro con la evolución de los Core Web Vitals.

## Reportes automáticos

Usa `scripts/generate-impact-report.mjs` para comparar periodos consecutivos:

```bash
node scripts/generate-impact-report.mjs --window-hours 6 --baseline-gap-hours 1
```

El script resume:

* Diferencias de volumen, error y latencia por endpoint (`• Endpoint ...`).
* Variación de errores JS entre ventanas.
* Tendencias de Core Web Vitals (p75 y porcentaje "good").
* Avisos (`⚠️`) cuando se detecta un incremento en errores o se supera un umbral clave.

Integra la salida en el runbook de despliegues o adjúntala al post-mortem cuando se reporten regresiones de rendimiento.

## Checklist previo a producción

Antes de promover un build a producción:

1. Ejecuta `node scripts/generate-impact-report.mjs` con una ventana que cubra la última hora y compara contra el periodo
   anterior.
2. Verifica en Grafana que `gw2_api_endpoint_error_percentage{endpoint="aggregate"}` se mantiene < 1 % y que `gw2_web_vital_value`
   (p75) cumple con los objetivos establecidos.
3. Confirma en `/admin/dashboard` que `cache.hitPercentage` no ha caído por debajo de 80 % y que `webVitals.metrics` sigue dentro
   de los rangos definidos.

Si cualquiera de estos pasos detecta una desviación, pausa el despliegue hasta comprender y mitigar la causa.
