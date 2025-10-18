# API Reference

## `GET /api/aggregate/bundle`

Aggregates price, icon and rarity information for one or more items.

### Query parameters

- `ids` (required): comma-separated list of numeric IDs or repeated `ids[]` parameters.
- `lang` (optional): locale code (default `es`). The server normalizes the value and applies fallbacks when needed.

### Response

When successful the endpoint returns a JSON object with the following shape:

```json
{
  "priceMap": {
    "123": { "id": 123, "buy_price": 100, "sell_price": 120 }
  },
  "iconMap": {
    "123": "https://example.cdn/item.png"
  },
  "rarityMap": {
    "123": "Rare"
  },
  "meta": {
    "lang": "es",
    "source": "aggregate",
    "stale": false,
    "snapshotAt": "2024-01-01T00:00:00.000Z",
    "warnings": []
  }
}
```

- `priceMap` includes Bazaar prices (null values when unavailable).
- `iconMap` and `rarityMap` contain presentation data for the same IDs.
- `meta.source` will be `aggregate` when the precomputed snapshot is available.
- When the aggregate contains warnings or recoverable errors, they are returned under `errors` and `meta.warnings`.

### Headers

- `Cache-Control`: `public, max-age=120, stale-while-revalidate=120` for fresh aggregates.
- `X-Data-Source`: Indicates the origin of the payload (`aggregate` or `fallback`).

### Fallback behaviour

If the aggregate snapshot cannot be retrieved or built, the service automatically falls back to the legacy bundle handler. In that case:

- `meta.source` and the `X-Data-Source` header are set to `fallback`.
- The response keeps the same shape (`priceMap`, `iconMap`, `rarityMap`, `meta`).
- Any warnings or errors propagated by the legacy handler are surfaced in the JSON body.

Requests without the `ids` parameter respond with HTTP `400` and include an `ids_required` error code.

### Monitoreo de fallbacks

- El servidor deja un `console.warn` (`[api] falling back to legacy bundle handler...`) cada vez que el agregado no puede resolver todos los IDs y es necesario acudir al handler PHP. Tras el despliegue conviene revisar los logs del proceso (`pm2 logs api` o `journalctl -fu api`) durante los primeros minutos para comprobar que el volumen de avisos se mantiene bajo.
- En el cliente, cuando la UI activa el fallback porque la API moderna falla, se agrega un evento a `window.__bundleFallbacks__`. Desde DevTools (`Application` → `Console`) se puede ejecutar `window.__bundleFallbacks__` para inspeccionar los últimos 50 eventos registrados (cada entrada incluye `ids`, `message` y `timestamp`). Esta métrica ayuda a detectar rápidamente si la API moderna está devolviendo errores de forma recurrente tras el despliegue.

## Feature flags relevantes

- `FEATURE_DONES_AGGREGATE`: controla si la página de dones consulta el agregado moderno (`true`) o fuerza el flujo legado (`false`). El valor se puede definir en `runtime-env.js`, `window.Config` o variables de entorno equivalentes. Cuando está deshabilitado el cliente omite la llamada a `fetchDonesAggregate`, registra un fallback con motivo `flag-disabled` y continúa con las consultas al `RecipeService` y los caches locales.
