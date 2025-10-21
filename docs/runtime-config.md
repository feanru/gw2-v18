# Runtime configuration

El archivo [`runtime-env.js`](../runtime-env.js) se ejecuta antes que cualquier bundle y
expone un objeto `window.__RUNTIME_CONFIG__` con claves que el frontend necesita para
ajustar rutas y toggles sin recompilar. Durante el post-build
[`scripts/update-html.js`](../scripts/update-html.js) valida que las claves críticas
estén presentes para evitar despliegues inconsistentes.

## Variables obligatorias

| Clave | Descripción |
| --- | --- |
| `API_BASE_URL` | Cadena con la URL base de la API. Se normaliza eliminando la barra final y puede sobrescribirse desde configuración segura. |
| `LANG` | Idioma activo del sitio. Se resuelve en el siguiente orden: configuración segura → configuración runtime → atributo `lang` del documento → `navigator.language` → `es`. |
| `FLAGS` | Objeto con toggles de QA/feature flags. Se aceptan objetos, arrays, cadenas (`flag`, `flag=value`) o combinaciones. Las claves duplicadas se fusionan respetando los valores de la configuración segura. |

Si alguna de estas variables falta o tiene un tipo incorrecto, `npm run build` fallará
durante la fase `postbuild`.

## Modo debug

`src/js/config.js` emite logs adicionales cuando está activo el modo debug. Esto ayuda a
QA a detectar si los bundles se cargan antes de que `runtime-env.js` esté disponible.
Se puede activar con cualquiera de las siguientes opciones:

- Definir `DEBUG_RUNTIME` (o `DEBUG`) en `window.__RUNTIME_CONFIG__` o en
  `window.__SECURE_RUNTIME_CONFIG__`.
- Definir `__RUNTIME_DEBUG__` o `__DEBUG__` en `window` antes de cargar los bundles.
- Añadir `?debugRuntime=1`, `?runtimeDebug=1` o `?debug-config=1` a la URL.

Cuando el modo debug está activo los logs muestran el timestamp `__loadedAt` de
`runtime-env.js`, el momento en que `config.js` se inicializa y el delta en milisegundos
entre ambos eventos.
