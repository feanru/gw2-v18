# Dones tabs: comportamiento de localStorage

## Objetivo
Verificar que la página `dones.html` siempre muestra la pestaña "Don de la Suerte" al abrirse y que sólo se persiste la selección del usuario después de la primera interacción.

## Pasos
1. Abrir una ventana nueva o pestaña en modo privado para asegurar que `localStorage` está limpio.
2. Navegar a `/dones.html`.
3. Confirmar que la pestaña "Don de la Suerte" (`tab-don-suerte`) aparece activa y visible.
4. Cambiar a cualquier otra pestaña (por ejemplo, "Tributo místico").
5. Recargar la página.
6. Verificar que la pestaña activa tras recargar vuelve a ser "Don de la Suerte".
7. Seleccionar nuevamente la pestaña alternativa.
8. Recargar de nuevo y confirmar que se mantiene el mismo comportamiento: al abrir, siempre inicia en "Don de la Suerte" hasta que el usuario elige otra pestaña en la sesión actual.

## Resultado esperado
- Antes de cualquier interacción, la pestaña "Don de la Suerte" siempre está activa.
- La selección del usuario se almacena en `localStorage` sólo después del primer clic en una pestaña.
- Tras recargar o reabrir la página, se inicia en "Don de la Suerte" y la pestaña almacenada sólo se restaura después de una nueva interacción del usuario.
