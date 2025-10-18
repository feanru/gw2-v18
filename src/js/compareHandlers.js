// compareHandlers.js
// Manejadores para acciones de la comparativa (guardar, etc.)

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initSaveComparativaHandler);

/**
 * Configura el botón de guardar comparativa
 */
function initSaveComparativaHandler() {
  if (window.saveCompInit) return;
  window.saveCompInit = true;
  const saveBtn = document.getElementById('btn-guardar-comparativa');
  if (!saveBtn) return;
  saveBtn.addEventListener('click', function () {
    if (window.comparativa && typeof window.comparativa.handleSaveComparativa === 'function') {
      window.comparativa.handleSaveComparativa();
    }
  });
}

// Si el DOM ya está listo al cargar este script
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(initSaveComparativaHandler, 1);
}
