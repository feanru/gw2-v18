// storageUtils.js - async helpers using backend API
import fetchWithRetry from './utils/fetchWithRetry.js';
import { normalizeApiResponse } from './utils/apiResponse.js';

/** Obtiene los favoritos del usuario desde el backend */
async function getFavoritos() {
    try {
        const r = await fetchWithRetry('backend/api/favorites.php');
        if (!r.ok) return [];
        const payload = await r.json().catch(() => null);
        const { data } = normalizeApiResponse(payload);
        return Array.isArray(data) ? data.map(id => ({ id: parseInt(id, 10) })) : [];
    } catch (e) {
        console.error('Error obteniendo favoritos', e);
        return [];
    }
}

/** Guarda un ítem como favorito en el backend */
async function saveFavorito(item) {
    if (!item || !item.id) return [];
    try {
        await fetchWithRetry('backend/api/favorites.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: item.id })
        });
    } catch (e) {
        console.error('Error guardando favorito', e);
    }
    navigator.serviceWorker?.controller?.postMessage({
        type: 'invalidate',
        url: 'backend/api/favorites.php'
    });
    return getFavoritos();
}

/** Elimina un favorito en el backend */
async function removeFavorito(itemId) {
    try {
        await fetchWithRetry(`backend/api/favorites.php?item_id=${itemId}`, { method: 'DELETE' });
    } catch (e) {
        console.error('Error eliminando favorito', e);
    }
    navigator.serviceWorker?.controller?.postMessage({
        type: 'invalidate',
        url: 'backend/api/favorites.php'
    });
    return getFavoritos();
}

/** Obtiene las comparativas guardadas desde el backend */
async function getComparativas() {
    try {
        const r = await fetchWithRetry('backend/api/comparisons.php');
        if (!r.ok) return [];
        const payload = await r.json().catch(() => null);
        const { data } = normalizeApiResponse(payload);
        const parseNames = (names) => {
            if (!names) return [];
            try {
                return Array.isArray(names) ? names : JSON.parse(names);
            } catch {
                return [];
            }
        };
        const parseIds = (ids, left, right) => {
            if (ids) {
                try {
                    const arr = Array.isArray(ids) ? ids : JSON.parse(ids);
                    return arr.map(n => Number(n));
                } catch { /* ignore */ }
            }
            return [Number(left), Number(right)].filter(n => !isNaN(n));
        };
        return Array.isArray(data)
            ? data.map(c => ({
                id: c.id,
                ids: parseIds(c.item_ids, c.item_left, c.item_right),
                nombres: parseNames(c.item_names)
            }))
            : [];
    } catch (e) {
        console.error('Error obteniendo comparativas', e);
        return [];
    }
}

/** Guarda una comparativa (usa los dos primeros IDs) */
async function saveComparativa(comparativa) {
    if (!comparativa || !Array.isArray(comparativa.ids) || comparativa.ids.length < 2) return [];
    try {
        await fetchWithRetry('backend/api/comparisons.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_ids: comparativa.ids,
                item_names: comparativa.nombres
            })
        });
    } catch (e) {
        console.error('Error guardando comparativa', e);
    }
    navigator.serviceWorker?.controller?.postMessage({
        type: 'invalidate',
        url: 'backend/api/comparisons.php'
    });
    return getComparativas();
}

/** Elimina una comparativa por id */
async function removeComparativa(id) {
    try {
        await fetchWithRetry(`backend/api/comparisons.php?id=${id}`, { method: 'DELETE' });
    } catch (e) {
        console.error('Error eliminando comparativa', e);
    }
    navigator.serviceWorker?.controller?.postMessage({
        type: 'invalidate',
        url: 'backend/api/comparisons.php'
    });
    return getComparativas();
}

/** Muestra un toast sencillo */
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.opacity = '0';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '1'; }, 10);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
            if (container.children.length === 0) container.remove();
        }, 300);
    }, 3000);
}

window.StorageUtils = {
    saveFavorito,
    getFavoritos,
    removeFavorito,
    saveComparativa,
    getComparativas,
    removeComparativa,
    showToast
};
