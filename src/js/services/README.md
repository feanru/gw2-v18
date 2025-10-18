# Servicios

Este directorio contiene utilidades para interactuar con la API de Guild Wars 2.

## recipeService.js

`getItemBundles(ids)` aplica ahora una estrategia de **stale-while-revalidate**:

1. Se consultan los datos almacenados en caché.
2. La función devuelve de inmediato los valores encontrados (o `null` si no existen).
3. En segundo plano se realiza la petición a la API para obtener información fresca.
4. Al completarse el `fetch` se actualiza el caché y se dispara el evento `bundleItemRefreshed` con los nuevos datos, permitiendo que la interfaz se actualice sin bloquearse.

