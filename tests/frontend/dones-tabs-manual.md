# Pruebas manuales: pestañas de dones

## Objetivo
Confirmar que la pestaña inicial siempre es **Don de la Suerte** al cargar la página `dones.html` y que la selección sólo se persiste después de que la persona usuaria interactúa.

## Pasos
1. Abrir `dones.html` en un navegador con el almacenamiento local limpio para el dominio (o usar una ventana privada).
2. Verificar que la pestaña visible sea `Don de la Suerte` (`tab-don-suerte`).
3. Sin hacer clic en ninguna pestaña, cerrar la pestaña o ventana del navegador y volver a abrir `dones.html`.
4. Confirmar que nuevamente se muestra `Don de la Suerte`.
5. Hacer clic en otra pestaña (por ejemplo `Tributo místico`) y comprobar que su contenido aparece.
6. Recargar la página.
7. Verificar que ahora la pestaña elegida se conserva gracias a la preferencia almacenada.

## Notas
- Si se intenta recargar sin haber hecho clic en otra pestaña, debe seguir mostrándose `Don de la Suerte`.
- Para forzar el flujo desde cero repetir el proceso en una ventana privada o limpiar el `localStorage` del sitio.
