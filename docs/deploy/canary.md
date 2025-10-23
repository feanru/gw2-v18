# Flujo de despliegue seguro (canary)

Este documento describe el procedimiento recomendado para lanzar un despliegue canary, verificar la salud del sistema mediante métricas en vivo y promover (o revertir) la versión de forma segura. Está diseñado para equipos distribuidos que necesitan coordinarse en cambios de frontend, backend y recursos CDN.

## Resumen del flujo

1. Preparar el entorno y confirmar disponibilidad del equipo.
2. Ejecutar `scripts/deploy-control.sh` para realizar el canary y esperar el periodo de estabilización.
3. Validar automáticamente las métricas críticas expuestas en `/metrics` (latencias p50/p95/p99, ratio de respuestas 304, bytes/visita y porcentaje de respuestas stale).
4. Si las métricas son saludables, promover el despliegue al 100 % de tráfico.
5. En caso de regresión, ejecutar rollback inmediato mediante `scripts/rollback.sh`.
6. Comunicar el resultado y actualizar el estado del despliegue.

## Preparación

Antes de iniciar el despliegue:

- **Sincronización:** Anunciar la ventana de despliegue en el canal `#deploys` con al menos 30 min de antelación. Confirmar que soporte/ops está disponible para monitoreo.
- **Build verificado:** Asegurarse de que `npm test` pasa y de que la carpeta `dist/` contiene el artefacto final.
- **Accesos:** Validar acceso SSH al servidor de despliegue (`/var/www/gw2`) y credenciales para dashboards.
- **Checklists previos:**
  - CDN listo para purga (confirmar `scripts/purge-cdn.js`).
  - Redis y Mongo operativos (consultar `docs/observability.md`).
  - Comunicación lista con soporte/CM para avisar a usuarios en caso de rollback.

## Uso de `deploy-control.sh`

El script `scripts/deploy-control.sh` automatiza el ciclo canary → validación → promoción. Ejemplo básico:

```bash
bash scripts/deploy-control.sh --metrics https://admin.gw2efficiency.com/metrics
```

Argumentos principales:

| Opción | Descripción |
|--------|-------------|
| `--release <sha>` | Forzar la versión a desplegar (por defecto usa `git rev-parse --short HEAD`). |
| `--canary <porcentaje>` | Tráfico inicial asignado al canary (default `10`). |
| `--wait <segundos>` | Espera antes de la primera medición (default `300`). |
| `--metrics <url>` | URL del endpoint `/metrics` a consultar. |
| `--samples <n>` | Número de muestras consecutivas que deben pasar los umbrales (default `3`). |
| `--interval <segundos>` | Pausa entre muestras (default `30`). |
| `--dry-run` | Muestra las acciones sin ejecutarlas (útil para revisiones). |
| `--skip-promote` | Ejecuta el canary y validación sin promover. |

Variables de entorno soportadas:

- `LATENCY_P50_THRESHOLD`, `LATENCY_P95_THRESHOLD`, `LATENCY_P99_THRESHOLD` (ms).
- `STALE_PERCENT_THRESHOLD` (porcentaje máximo de respuestas stale).
- `MIN_NOT_MODIFIED_RATIO` (ratio mínimo de respuestas 304 sobre el total).
- `MAX_BYTES_PER_VISIT` (límite promedio de bytes entregados por visita).
- `DEPLOY_METRICS_URL` (fallback para `--metrics`).

Durante la ejecución, el script:

1. Llama a `scripts/deploy.sh` con `CANARY_PERCENT=<valor>` para activar el canary.
2. Espera la ventana de estabilización (`--wait`).
3. Consulta `/metrics` usando `curl` y valida que los valores estén dentro de los umbrales definidos.
4. En caso de fallo, llama inmediatamente a `scripts/rollback.sh` y finaliza con error.
5. Si las métricas son saludables y no se indicó `--skip-promote`, vuelve a ejecutar `scripts/deploy.sh` con el porcentaje final (`PROMOTE_PERCENT`, default 100) y repite la verificación post-promoción.

Los mensajes del script incluyen las muestras de métricas para facilitar seguimiento en tiempo real.

## Rollback

`scripts/rollback.sh` simplifica revertir al release anterior:

```bash
bash scripts/rollback.sh            # vuelve al release inmediatamente anterior
bash scripts/rollback.sh v1.2.3     # activa un release específico
PURGE_CDN=1 bash scripts/rollback.sh
```

El script actualiza el symlink `current` dentro de `/var/www/gw2/releases`, opcionalmente purga la CDN y registra cada paso. Si no existe un release previo válido aborta con error.

## Métricas monitoreadas

El endpoint `/metrics` (ver `backend/api/metrics.js`) expone:

- `gw2_api_latency_p50_ms`, `gw2_api_latency_p95_ms`, `gw2_api_latency_p99_ms`.
- `gw2_api_responses_not_modified_ratio` (tasa de respuestas 304).
- `gw2_api_responses_stale_percentage`.
- `gw2_api_bytes_per_visit` y `gw2_api_payload_bytes_per_visit`.
- Métricas adicionales de payload, TTFB y JS errors que sirven como contexto.

El dashboard administrativo (`/admin`) consume el mismo snapshot; revisar la sección “Métricas API” para confirmar visualmente que no haya alertas rojas antes de promover.

## Checklist de coordinación

Previo al despliegue:

- [ ] Confirmar ventana y responsables en `#deploys`.
- [ ] Validar estado verde en CI/CD y dashboard de salud (Mongo/Redis OK).
- [ ] Avisar a soporte sobre la ventana y canal de updates.
- [ ] Revisar `docs/observability/impact-metrics.md` y dejar constancia de que los umbrales de impacto siguen siendo válidos.
- [ ] Preparar mensaje de rollback (en caso de fallo).

Durante el despliegue:

- [ ] Ejecutar `deploy-control.sh` con la URL de métricas correcta.
- [ ] Supervisar logs del script y el dashboard en tiempo real.
- [ ] Registrar en `#deploys` cada transición (canary iniciado, métricas aprobadas, promoción finalizada).

Post despliegue:

- [ ] Confirmar que `gw2_api_latency_*` y `% stale` permanecen dentro de los rangos esperados.
- [ ] Purga de CDN completada (automática en `deploy.sh`, manual en rollback si aplica).
- [ ] Actualizar documento de estado o tablero de releases.
- [ ] Cerrar la ventana en `#deploys` indicando resultado y próximos pasos.

Mantener este flujo asegura que los feature flags y asignaciones canary del backend se sincronicen correctamente con el frontend y que las regresiones se detecten antes de impactar a todos los usuarios.
