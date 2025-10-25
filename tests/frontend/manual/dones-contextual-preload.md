# Precarga contextual de dones

## Objetivo
Validar que cada pestaña de `dones.html` solicita únicamente los recursos de su propio contexto y que los datos de `LegendaryData` sólo se consultan al abrir la pestaña de dones legendarios (tab 4).

## Preparación
1. Abrir una ventana o pestaña en modo incógnito/privado para evitar caché previa.
2. Navegar a `/dones.html`.
3. Abrir la consola del navegador (F12) y asegurarse de tener visible la pestaña **Console**.
4. Inicializar el contador manual ejecutando en la consola:
   ```js
   window.__donesPreloadLog__ = [];
   ```

## Pasos
1. Con la página recién cargada (pestaña "Don de la Suerte" activa por defecto), evaluar en consola:
   ```js
   window.__donesPreloadLog__.map(({ type, context, legendary }) => ({ type, context, legendary }))
   ```
   Debe existir un único evento con `context: "special"` y `legendary: false`.
2. Cambiar a la pestaña **"Tributo místico"** y esperar a que finalice la carga. Ejecutar nuevamente la instrucción anterior y confirmar que aparece un nuevo evento con `context: "tributo"`.
3. Cambiar a la pestaña **"Tributo dracónico"** y repetir la verificación. El evento adicional debe mostrar `context: "draconic"` y continuar con `legendary: false`.
4. Cambiar a la pestaña **"Dones de armas legendarias"**. Tras la carga, el registro debe incluir un nuevo evento con `context: "legendary"` y `legendary: true`.
5. Para validar un orden distinto, limpiar el log (`window.__donesPreloadLog__ = []`) y abrir las pestañas en cualquier otro orden (por ejemplo: 3 → 1 → 4 → 2). Comprobar que los contextos aparecen exactamente en el orden visitado y que `legendary: true` sólo figura cuando se abre la pestaña 4.

## Resultado esperado
- Cada activación de pestaña genera un evento de tipo `fetch` o `reuse` con el contexto correspondiente (`special`, `tributo`, `draconic`, `legendary`).
- Hasta que no se abra la pestaña 4, ningún evento debe marcar `legendary: true` ni listar `context: "legendary"`.
- Los arrays `extraIds` y `ids` de los eventos sólo contienen los identificadores asociados al contexto de la pestaña que se está cargando.
- Al recargar la página, el primer evento siempre vuelve a ser `special`, y la secuencia de eventos posteriores respeta el orden en que se visitan las pestañas.
