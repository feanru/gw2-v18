# Contrato de datos para adaptadores de frontend

Los adaptadores ubicados en `src/js/adapters/` exponen una API consistente para
transformar respuestas heterogéneas de los servicios en un modelo utilizable por
la UI. Todos los adaptadores retornan objetos con las siguientes propiedades
comunes:

- `item`: información básica del ítem (o `null` si no está disponible).
- `prices`: resumen con `unit` (precios unitarios) y `totals` (totales agregados).
  Ambos subcampos normalizan a números o `null`, y la bandera `hasData` indica si
  la respuesta contenía valores útiles.
- `recipes`: arreglo con recetas normalizadas; `primary` o `primaryRecipe`
  expone la primera receta cuando aplica.
- `meta`: metadatos normalizados que garantizan la presencia de `lang` y `stale`.

Los adaptadores específicos aportan campos adicionales:

- `aggregateAdapter`: agrega `tree`, `legacy` (payload legado) y mantiene la
  compatibilidad con `market` para código histórico.
- `legacyAdapter`: expone `nestedRecipe` y conserva el payload original en
  `legacy` para depuración.
- `priceAdapter`: convierte mapas o entradas sueltas de precios al resumen común.
- `recipeAdapter`: asegura que cualquier forma de receta (objeto o arreglo) se
  devuelva como lista normalizada.

## Reglas de uso

1. **Siempre** consumir los servicios (`aggregateService`, `recipeService`, etc.)
   a través del modelo que entrega el adaptador (`response.model`).
2. Ante datos incompletos, usar `mergePriceSummaries` para combinar fuentes
   (por ejemplo, legado + cache de precios) antes de tocar la UI.
3. Si se agrega un nuevo campo requerido por la UI, documentarlo aquí y
   extender los adaptadores correspondientes.

## Checklist para cambios

- [ ] El nuevo campo o comportamiento se añadió al adaptador correcto.
- [ ] Se actualizaron las pruebas unitarias y/o de frontend que cubren el caso.
- [ ] Se verificó que los consumidores relevantes lean el modelo del adaptador.

