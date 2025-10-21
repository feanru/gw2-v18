# Dashboard de administración

El endpoint `GET /admin/dashboard` devuelve un snapshot con métricas operativas del backend. El acceso requiere enviar el token configurado en `ADMIN_DASHBOARD_TOKEN` mediante un encabezado `Authorization: Bearer <token>` o `X-Admin-Token`.

## Estructura de la respuesta

```json
{
  "generatedAt": "2024-05-01T10:30:00.000Z",
  "windowMinutes": 15,
  "freshness": {
    "items": {
      "collection": "items",
      "count": 52341,
      "lastUpdated": "2024-05-01T10:00:00.000Z",
      "lastUpdatedAgeMinutes": 30.5,
      "lastSuccess": "2024-05-01T10:00:00.000Z",
      "failures24h": 0
    },
    "prices": {
      "collection": "prices",
      "count": 9876,
      "lastUpdated": "2024-05-01T10:27:00.000Z",
      "lastUpdatedAgeMinutes": 3.0,
      "lastSuccess": "2024-05-01T10:27:00.000Z",
      "failures24h": 1
    }
  },
  "responses": {
    "total": 1200,
    "stale": 24,
    "ratio": 0.02
  },
  "latency": {
    "p95": 850,
    "p99": 1200,
    "sampleCount": 1150
  },
  "ingestionFailures": {
    "total24h": 2,
    "byCollection": {
      "items": 0,
      "prices": 2,
      "recipes": 0
    },
    "windowHours": 24
  },
  "jsErrors": {
    "windowMinutes": 15,
    "count": 42,
    "perMinute": 2.8,
    "lastErrorAt": "2024-05-01T10:29:55.000Z",
    "lastErrorAgeMinutes": 0.1,
    "lastMessage": "ReferenceError: boom",
    "lastSource": "bundle.js",
    "lastFingerprint": "a1b2c3",
    "top": [
      { "fingerprint": "a1b2c3", "count": 20, "message": "ReferenceError: boom" }
    ]
  },
  "mongo": {
    "indexSizeAlertThreshold": 104857600,
    "indexStats": {
      "items": {
        "totalIndexSize": 16777216,
        "storageSize": 33554432,
        "count": 52341,
        "exceeded": false
      },
      "apiMetrics": {
        "totalIndexSize": 5242880,
        "storageSize": 12582912,
        "count": 6721,
        "exceeded": false
      }
    }
  },
  "alerts": [
    { "type": "freshness-stale", "collection": "items", "ageMinutes": 75 },
    { "type": "js-error-rate", "perMinute": 6.4 },
    { "type": "mongo-index-footprint", "collection": "items", "totalIndexSize": 16777216 }
  ]
}
```

### Campos destacados

- **freshness.*.lastUpdatedAgeMinutes**: minutos transcurridos desde la última actualización conocida de cada colección.
- **jsErrors**: métricas agregadas de la ventana reciente. `perMinute` se compara con `ADMIN_JS_ERROR_ALERT_THRESHOLD_PER_MINUTE` para generar alertas.
- **mongo.indexStats**: resumen del tamaño de índices (`totalIndexSize`) y almacenamiento (`storageSize`) para las colecciones monitorizadas. Cuando un valor supera `ADMIN_INDEX_SIZE_ALERT_BYTES`, el dashboard genera la alerta `mongo-index-footprint`.
- **alerts**: lista de alertas activas. Las nuevas claves `freshness-stale` y `js-error-rate` se registran en consola y pueden enviar un webhook si `ADMIN_ALERT_WEBHOOK_URL` está definido.

Las métricas se calculan usando la misma ventana definida por `ADMIN_DASHBOARD_WINDOW_MINUTES`. Si necesitas ampliar o reducir la sensibilidad, ajusta las variables de entorno descritas en [`backend/README.md`](../backend/README.md).
