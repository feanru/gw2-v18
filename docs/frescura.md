# Política de frescura de datos

Este documento resume los tiempos de actualización y caducidad que ya están configurados en el proyecto para los diferentes tipos de datos y servicios.

## Caché en el frontend

| Dataset | Fuente | Estrategia | Vigencia |
| --- | --- | --- | --- |
| Detalles de ítems | API oficial de Guild Wars 2 | Se considera estable y se almacena sin caducidad explícita. | Sin expiración (invalida manualmente). |
| Recetas | API oficial de Guild Wars 2 | Contenido estable, almacenado indefinidamente. | Sin expiración (invalida manualmente). |
| Precios y bundles de mercado | API del bazar | Se invalida con una TTL corta para reflejar las variaciones. | 5 minutos. |
| Historial horario de mercado | API del bazar | Se invalida con una TTL larga dado que los históricos cambian poco. | 24 horas. |

Los valores anteriores se definen de forma centralizada en `src/js/utils/cachePolicies.js`, por lo que cualquier cambio debe hacerse allí para mantener un comportamiento consistente en todos los módulos que consumen el caché del navegador.【F:src/js/utils/cachePolicies.js†L1-L16】

## Caché en el backend

| Tipo de petición | Variable | Descripción | Valor por defecto |
| --- | --- | --- | --- |
| Consultas rápidas (precios, resúmenes) | `CACHE_TTL_FAST` | TTL corta para evitar servir precios obsoletos. | 120 segundos. |
| Consultas pesadas (catálogos, listados) | `CACHE_TTL_SLOW` | TTL larga para reducir carga en agregaciones grandes. | 1 800 segundos (30 minutos). |
| Tiempo máximo de espera por petición externa | `FETCH_TIMEOUT_MS` | Se aborta el fetch si la API no responde a tiempo. | 15 000 ms (15 s). |
| Tiempo máximo permitido para agregaciones internas | `MAX_AGGREGATION_MS` | Evita que operaciones complejas bloqueen el backend. | 12 000 ms (12 s). |

Todas estas variables pueden sobrescribirse mediante entorno, pero cuentan con valores predeterminados seguros definidos en `AppConfig` para garantizar tiempos de respuesta razonables aun sin configuración extra.【F:backend/config/app.php†L1-L84】

## Alertas operativas

El endpoint `/admin/dashboard` expone el campo `freshness[collection].lastUpdatedAgeMinutes`, que indica cuántos minutos han transcurrido desde la última actualización conocida de cada colección. Si supera el umbral definido en `ADMIN_FRESHNESS_ALERT_THRESHOLD_MINUTES` (60 minutos por defecto) se genera una alerta `freshness-stale`, se registra en los logs y puede enviarse a un webhook (`ADMIN_ALERT_WEBHOOK_URL`). Además, se incluyen métricas agregadas de errores de JavaScript (`jsErrors.perMinute`) que disparan la alerta `js-error-rate` cuando la tasa excede `ADMIN_JS_ERROR_ALERT_THRESHOLD_PER_MINUTE` (valor predeterminado de 5 eventos por minuto). Como complemento, la sección `mongo.indexStats` del snapshot evalúa el tamaño de los índices; si cualquiera supera `ADMIN_INDEX_SIZE_ALERT_BYTES` se emite una alerta `mongo-index-footprint`, útil para anticipar crecimientos anómalos en las colecciones monitorizadas.【F:backend/api/index.js†L640-L851】

## Tareas programadas

El job `refresh_critical_items.php` consulta periódicamente los endpoints de ítems críticos para mantenerlos calientes. Se recomienda ejecutarlo cada 15 minutos (como en el ejemplo de cron) para minimizar el tiempo en que un ítem puede quedar desactualizado.【F:backend/README.md†L32-L47】

## Política de idioma

El backend determina el idioma activo a partir de la variable de entorno `DEFAULT_LANG`, con un valor predeterminado en español (`es`) si no se proporciona ningún otro. Cada respuesta de la API incluye el idioma resuelto dentro de `meta.lang`, lo que permite a los clientes validar que los datos que reciben están alineados con la configuración actual.【F:backend/config/app.php†L44-L58】【F:backend/api/response.php†L1-L38】
