// itemHandlers.js
// Manejadores para las acciones de los ítems

document.addEventListener('DOMContentLoaded', function() {
    // Inicializar manejador del botón de guardar ítem
    initSaveItemHandler();
});

/**
 * Inicializa el manejador del botón de guardar ítem
 */
function initSaveItemHandler() {
    const saveButton = document.getElementById('btn-guardar-item');
    if (!saveButton) return;
    // Registrar manejador de clic independientemente del estado de autenticación
    saveButton.addEventListener('click', handleSaveItem);
}

/**
 * Intenta extraer el nombre del ítem desde el DOM.
 */
function getItemNameFromDom() {
    const selectors = [
        '#item-header .item-link',
        '#item-header .item-name',
        '#item-header [data-item-name]',
        '#item-header h1',
        '#item-header h2',
        '.ingred-row[data-path] .item-link'
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        const text = element?.textContent?.trim();
        if (text) return text;
    }

    return null;
}

/**
 * Espera brevemente a que el título del ítem esté disponible en el DOM.
 * Devuelve el nombre encontrado o null si no se pudo obtener a tiempo.
 */
function waitForItemTitle(timeout = 1500) {
    const existingName = getItemNameFromDom();
    if (existingName) {
        return Promise.resolve(existingName);
    }

    const header = document.getElementById('item-header');
    if (!header) {
        return Promise.resolve(null);
    }

    return new Promise(resolve => {
        const observer = new MutationObserver(() => {
            const updatedName = getItemNameFromDom();
            if (updatedName) {
                observer.disconnect();
                resolve(updatedName);
            }
        });

        observer.observe(header, { childList: true, subtree: true, characterData: true });

        setTimeout(() => {
            observer.disconnect();
            resolve(getItemNameFromDom());
        }, timeout);
    });
}

async function resolveItemName() {
    const fromDom = getItemNameFromDom();
    if (fromDom) return fromDom;

    const ingredientName = window.ingredientObjs?.[0]?.name?.trim();
    if (ingredientName) return ingredientName;

    const awaitedName = await waitForItemTitle();
    if (awaitedName) return awaitedName;

    const fallbackIngredient = window.ingredientObjs?.[0]?.name?.trim();
    return fallbackIngredient || 'Ítem sin nombre';
}

/**
 * Maneja el guardado de un ítem
 */
async function handleSaveItem() {
    const user = window.Auth && window.Auth.currentUser;
    if (!user) {
        if (window.showAuthOptions) {
            window.showAuthOptions();
        } else if (window.Auth && window.Auth.requireAuth) {
            window.Auth.requireAuth();
        }
        return;
    }

    // Obtener datos del ítem actual
    const itemId = new URLSearchParams(window.location.search).get('id');
    const itemName = await resolveItemName();
    
    if (!itemId) {
        window.StorageUtils?.showToast('No se pudo obtener el ítem actual', 'error');
        return;
    }
    
    // Guardar el ítem
    const item = { id: parseInt(itemId, 10), nombre: itemName };
    if (window.StorageUtils && window.StorageUtils.saveFavorito) {
        await window.StorageUtils.saveFavorito(item);
    }
    
    // Mostrar notificación
    window.StorageUtils?.showToast('Ítem guardado en favoritos');
}

// Inicialización automática si el DOM ya está cargado
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initSaveItemHandler, 1);
}
