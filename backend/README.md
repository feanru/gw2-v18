# Backend

## Utilidades HTTP

El archivo [`httpUtils.php`](httpUtils.php) ofrece funciones compartidas como `multi_fetch` y los helpers `parse_market_csv` y `parse_market_bundle_csv` para consumir y procesar datos de la API.

## Índices de MongoDB

Este proyecto utiliza una base de datos MongoDB para almacenar colecciones de **items** y **recipes**. Para optimizar las consultas se requieren los siguientes índices:

### items

- `{ id: 1 }`
- `{ lang: 1 }`
- `{ tradable: 1 }`

### recipes

- `{ output_item_id: 1 }`
- `{ input_item_id: 1 }`

### apiMetrics

- `{ endpoint: 1, createdAt: 1 }`
- `{ createdAt: 1 }` con TTL dinámico (ver `SNAPSHOT_RETENTION_DAYS`).

### jsErrors

- `{ receivedAt: 1 }` con TTL configurable mediante `JS_ERROR_RETENTION_DAYS` (por defecto 30 días).
- `{ occurredAt: -1 }` para consultar los fallos más recientes.
- `{ fingerprint: 1, receivedAt: -1 }` para identificar eventos recurrentes.

### jsErrorStats

- `{ updatedAt: -1 }` para recuperar el último resumen consolidado.
- `{ fingerprint: 1 }` (filtro parcial) para los contadores por tipo de error.

### aggregateSnapshots

- `{ itemId: 1, lang: 1 }` (índice único para reutilizar snapshots por idioma).
- `{ itemId: 1, lang: 1, snapshotAt: -1 }` con `partialFilterExpression` (`snapshotAt` existente) y TTL configurable mediante `AGGREGATE_SNAPSHOT_RETENTION_DAYS` o `AGGREGATE_SNAPSHOT_TTL_DAYS` (en días, por defecto **90**).

### operationalEvents

- `{ type: 1, timestamp: -1 }` con `partialFilterExpression` y TTL ajustable con `OPERATIONAL_EVENT_RETENTION_DAYS` o `OPERATIONAL_EVENT_TTL_DAYS` (por defecto **30** días). Permite consultar rápidamente alertas y eventos operativos recientes.

### Migración

Ejecuta el siguiente comando para crear los índices anteriores en la base de datos configurada por la variable `MONGO_URL` (por defecto `mongodb://localhost:27017/gw2`):

```bash
npm run migrate:mongo
```

El comando anterior ejecuta el script [`backend/setup.mongo.js`](setup.mongo.js) que se encarga de crear los índices.

## Auditoría de índices y planes de consulta

El script [`scripts/analyze-mongo.js`](../scripts/analyze-mongo.js) ejecuta `db.collection.stats()` y `explain()` sobre las consultas más comunes de cada colección. Puedes integrarlo en CI o cron para validar que los índices siguen teniendo el tamaño esperado:

```bash
npm run analyze:mongo -- --json > mongo-report.json
```

Variables útiles:

- `ANALYZE_MONGO_COLLECTIONS`: lista separada por comas con las colecciones a inspeccionar (por defecto `items,prices,recipes,apiMetrics,aggregateSnapshots,jsErrors`).
- `MONGO_ANALYZE_INDEX_THRESHOLD`: umbral de tamaño de índices (en bytes) para marcar una colección como excedida. Si no se define, se reutiliza `ADMIN_INDEX_SIZE_ALERT_BYTES`.

### Preferencia de lectura

Los agregados (`buildItemAggregate`) usan la variable `MONGO_READ_PREFERENCE` para decidir desde qué réplica leer. Por defecto se utiliza `secondaryPreferred` para apuntar a una réplica local sin bloquear el primario. En entornos sin réplica (desarrollo, test) puedes ajustar `MONGO_READ_PREFERENCE=primary` para forzar las lecturas al nodo principal.

## Actualización periódica de items críticos

El script `refresh_critical_items.php` consulta los endpoints `dataBundle.php` e `itemDetails.php` para una lista de IDs críticos con el fin de mantener la caché caliente. Registra el resultado de cada petición en `refresh.log`.

### Ejecución manual

```bash
php refresh_critical_items.php
```

### Programación

Ejemplo con **cron** para ejecutarlo cada 15 minutos:

```cron
*/15 * * * * /usr/bin/php /ruta/al/proyecto/backend/refresh_critical_items.php >> /ruta/al/proyecto/backend/refresh.log 2>&1
```

Ejemplo con **systemd**:

```ini
# /etc/systemd/system/gw2-critical.service
[Unit]
Description=GW2 critical cache refresh

[Service]
ExecStart=/usr/bin/php /ruta/al/proyecto/backend/refresh_critical_items.php
Restart=always

[Install]
WantedBy=multi-user.target
```

Tras crear el servicio:

```bash
sudo systemctl enable --now gw2-critical.service
```

## Limpieza de snapshots y métricas

El planificador Node (`backend/jobs/index.js`) incluye el job `cleanupSnapshots` que archiva métricas antiguas de `apiMetrics` en la colección `apiMetricsArchive` y elimina los documentos que superen la retención configurada. El proceso calcula resúmenes diarios con promedios de latencia y desglose por código de estado antes de depurar la colección principal.

Variables de entorno relevantes:

- `SNAPSHOT_RETENTION_DAYS` (por defecto **7**): días que se conservan en `apiMetrics` antes de archivar y eliminar.
- `SNAPSHOT_ARCHIVE_ENABLED` (por defecto **true**): permite desactivar el archivado si solo se desea purgar.
- `SNAPSHOT_ARCHIVE_COLLECTION` / `SNAPSHOT_COLLECTION`: nombres de colecciones para los datos origen y archivo.
- `SNAPSHOT_CLEANUP_INTERVAL` (por defecto **6 horas**): frecuencia del job de limpieza.
- `DASHBOARD_CACHE_MS` (por defecto **60000**): ventana de caché para reutilizar el snapshot del dashboard al ajustar intervalos.
- `JS_ERROR_BACKUP_ENABLED` (por defecto **false**): activa el respaldo de documentos antiguos de `jsErrors` en `JS_ERROR_BACKUP_COLLECTION` antes de eliminarlos.
- `JS_ERROR_MIN_RETENTION_DAYS` (por defecto **7**): límite inferior de retención para `jsErrors` para evitar depurar datos demasiado recientes.
- `PRICE_HISTORY_RETENTION_DAYS` (por defecto **90**): retención para colecciones históricas de precios (`PRICE_HISTORY_COLLECTION`).
- `PRICE_HISTORY_BACKUP_ENABLED` y `PRICE_HISTORY_BACKUP_COLLECTION`: controlan el respaldo opcional previo a la purga de `priceHistory`.

Al ejecutar `npm run migrate:mongo` se crean/actualizan los índices necesarios, incluido el TTL dinámico de `apiMetrics` y los índices de `apiMetricsArchive` (`day` único y `archivedAt`).

## Telemetría de errores de JavaScript

El backend expone el endpoint `POST /telemetry/js-error` para recibir eventos capturados en el frontend. El cuerpo debe enviarse en JSON (puede ser un objeto o un array de objetos) con campos como `message`, `stack`, `source`, `line`, `column`, `tags` y `meta`. El colector normaliza cada entrada, calcula una huella (`fingerprint`) y persiste el evento en la colección `jsErrors`, además de actualizar un resumen incremental en `jsErrorStats` y contadores temporales en Redis.

La respuesta utiliza el formato habitual de la API (`meta`, `data`, `errors`) y devuelve un código **202** cuando los eventos se han aceptado correctamente:

```json
{
  "data": { "accepted": 3 },
  "meta": {
    "source": "telemetry",
    "lang": "es",
    "stale": false,
    "lastUpdated": "2024-05-01T10:15:00.000Z"
  }
}
```

Variables relevantes:

- `ADMIN_JS_ERROR_MAX_BYTES` (por defecto **16384**): tamaño máximo permitido para el cuerpo de la petición.
- `ADMIN_JS_ERROR_WINDOW_MINUTES` (por defecto igual a `ADMIN_DASHBOARD_WINDOW_MINUTES`): ventana para calcular la tasa reciente.
- `ADMIN_JS_ERROR_ALERT_THRESHOLD_PER_MINUTE` (por defecto **5**): umbral de alertas cuando la tasa supera este valor.
- `ADMIN_FRESHNESS_ALERT_THRESHOLD_MINUTES` (por defecto **60**): minutos máximos permitidos sin actualizar una colección antes de generar una alerta.
- `ADMIN_ALERT_WEBHOOK_URL`: URL opcional para enviar alertas (se realiza un `POST` con los detalles del evento).
- `ADMIN_ALERT_WEBHOOK_COOLDOWN_MS` (por defecto **300000**): enfriamiento mínimo entre notificaciones al mismo webhook.
- `JS_ERROR_RETENTION_DAYS` (por defecto **30**): días que se conservan los eventos individuales en `jsErrors`.
- `ADMIN_INDEX_SIZE_ALERT_BYTES` (por defecto **0**, desactivado): umbral de tamaño de índices que dispara la alerta `mongo-index-footprint` en el dashboard.
- `ADMIN_INDEX_MONITORED_COLLECTIONS`: lista separada por comas con las colecciones a auditar en el dashboard (por defecto `items,prices,recipes,apiMetrics,aggregateSnapshots,jsErrors`).

El snapshot del dashboard de administración (`/admin/dashboard`) ahora incluye el bloque `jsErrors` con los agregados de la ventana reciente (`count`, `perMinute`, `lastMessage`, `top`, etc.) y un nuevo campo `lastUpdatedAgeMinutes` en cada colección de `freshness`. Cuando la edad supera `ADMIN_FRESHNESS_ALERT_THRESHOLD_MINUTES` o la tasa de errores JS rebasa `ADMIN_JS_ERROR_ALERT_THRESHOLD_PER_MINUTE`, se añaden alertas automáticas, se registran en consola y, si hay webhook configurado, se envían notificaciones.
Además, el dashboard expone la sección `mongo.indexStats` con el tamaño de los índices monitorizados. Si alguno supera el umbral configurado, se genera una alerta `mongo-index-footprint`, visible en la interfaz y reutilizable por el planificador para ajustar tareas.
