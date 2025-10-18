// js/item-mejores.js
// Estructura base para análisis avanzado de ítems GW2
// Mantiene la arquitectura y estilos compatibles con item.html y compare-craft

import { getCached, setCached } from './utils/cache.js';
import { fetchWithCache } from './utils/requestCache.js';

// Referencias a elementos para la pestaña 'Mejores Horas y Mercado' en item.html
function getMejoresHorasElements() {
    return {
        ventasComprasChartCtx: document.getElementById('ventas-compras-chart')?.getContext('2d'),
        horaPuntaDiv: document.getElementById('hora-punta'),
        promedioHoraDiv: document.getElementById('promedio-hora'),
        promedioDiaDiv: document.getElementById('promedio-dia')
    };
}

let ventasComprasChart = null;
let ventasComprasWorker = null;

function runIdleTasks(tasks) {
    const scheduleIdle = (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
        ? window.requestIdleCallback.bind(window)
        : (cb) => {
            const start = Date.now();
            return setTimeout(() => cb({
                didTimeout: false,
                timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
            }), 0);
        };

    function runner(deadline) {
        const idleDeadline = deadline || { timeRemaining: () => 0 };
        while (idleDeadline.timeRemaining() > 0 && tasks.length) {
            const task = tasks.shift();
            if (typeof task === 'function') task();
        }
        if (tasks.length) {
            scheduleIdle(runner);
        }
    }

    scheduleIdle(runner);
}

// Utilidad para limpiar indicadores y alertas
function limpiarUI() {
    const els = getMejoresHorasElements();
    els.horaPuntaDiv.innerHTML = '';
    els.promedioHoraDiv.innerHTML = '';
    els.promedioDiaDiv.innerHTML = '';
    if (ventasComprasChart) {
        ventasComprasChart.destroy();
        ventasComprasChart = null;
    }
}

// Función global para integración en item.html
window.cargarMejoresHorasYMercado = async function(itemID) {
    limpiarUI();
    await cargarDatosItem(itemID);
};

// Función principal de carga y análisis
async function cargarDatosItem(itemID) {
    // 1. Obtener histórico horario
    // 2. Obtener estado actual
    // 3. Procesar y mostrar cada módulo
    try {
        const history = await obtenerHistorialHorario(itemID);
        const estado = await obtenerEstadoActual(itemID);
        mostrarGraficoVentasCompras(history);
        mostrarHoraPunta(history);
        mostrarPromedios(history);
    } catch (err) {
        console.error('Error al cargar datos del ítem', err);
    }
}

// --- Funciones stub para cada módulo ---
export async function obtenerHistorialHorario(itemID) {
    const cacheKey = `history_${itemID}`;
    const cached = getCached(cacheKey, true);
    const headers = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    try {
        const url = `https://api.datawars2.ie/gw2/v2/history/hourly/json?itemID=${itemID}`;
        const response = await fetchWithCache(url, { headers }, cacheKey, cached);
        if (response.status === 304 && cached) return cached.value;
        if (!response.ok) {
            throw new Error(`Error al obtener histórico horario: ${response.statusText}`);
        }
        const data = await response.json();
        const etag = response.headers.get('ETag');
        const lastModified = response.headers.get('Last-Modified');
        setCached(cacheKey, data, undefined, { etag, lastModified });
        return data;
    } catch (err) {
        console.error('Error al obtener histórico horario', err);
        throw new Error(`Error al obtener histórico horario: ${err.message}`);
    }
}

export async function obtenerEstadoActual(itemID) {
    const cacheKey = `price_${itemID}`;
    const cached = getCached(cacheKey, true);
    const headers = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    try {
        const fields = 'buy_price,sell_price,buy_quantity,sell_quantity,last_updated';
        const url = `https://api.datawars2.ie/gw2/v1/items/json?fields=${fields}&ids=${itemID}`;
        const response = await fetchWithCache(url, { headers }, cacheKey, cached);
        if (response.status === 304 && cached) return cached.value;
        if (!response.ok) {
            throw new Error(`Error al obtener estado actual: ${response.statusText}`);
        }
        const data = await response.json();
        const result = Array.isArray(data) ? (data[0] || {}) : (data || {});
        const etag = response.headers.get('ETag');
        const lastModified = response.headers.get('Last-Modified');
        setCached(cacheKey, result, undefined, { etag, lastModified });
        return result;
    } catch (err) {
        console.error('Error al obtener estado actual', err);
        throw new Error(`Error al obtener estado actual: ${err.message}`);
    }
}
function mostrarGraficoVentasCompras(history) {
    const { ventasComprasChartCtx } = getMejoresHorasElements();
    if (!ventasComprasChartCtx) return;
    if (!history || history.length === 0) {
        const tablaExistente = document.getElementById('mejores-table');
        if (tablaExistente) tablaExistente.remove();
        return;
    }
    if (!ventasComprasWorker) {
        ventasComprasWorker = new Worker(
            new URL('./workers/ventasComprasWorker.js', import.meta.url),
            { type: 'module' }
        );
    }
    ventasComprasWorker.onmessage = (ev) => {
        const data = ev.data || {};
        if (data.empty) {
            const tablaExistente = document.getElementById('mejores-table');
            if (tablaExistente) tablaExistente.remove();
            return;
        }
        const { etiquetas, ventas, compras, horaMin, horaMax, totalHoras } = data;
        let resumenDiv = document.getElementById('resumen-horas');
        if (!resumenDiv) {
            resumenDiv = document.createElement('div');
            resumenDiv.id = 'resumen-horas';
            resumenDiv.className = 'info-box';
            const card = ventasComprasChartCtx.canvas.closest('.card');
            if (card) card.insertBefore(resumenDiv, card.firstChild);
        }
        function formateaFechaHistorial(fechaStr) {
            let dateObj = fechaStr ? new Date(fechaStr) : null;
            if (dateObj && !isNaN(dateObj)) {
                return `${dateObj.getFullYear()}-${(dateObj.getMonth()+1).toString().padStart(2,'0')}-${dateObj.getDate().toString().padStart(2,'0')} ${dateObj.getHours().toString().padStart(2,'0')}:00`;
            }
            return fechaStr;
        }
        const resumenHtml = `<strong>Historial:</strong> ${formateaFechaHistorial(horaMin)} &rarr; ${formateaFechaHistorial(horaMax)} &nbsp; | &nbsp; <strong>Total de horas:</strong> ${totalHoras}`;
        const tasks = [
            () => { resumenDiv.innerHTML = resumenHtml; }
        ];
        if (ventasComprasChart) tasks.push(() => ventasComprasChart.destroy());
        tasks.push(() => {
            ventasComprasChart = new Chart(ventasComprasChartCtx, {
                type: 'line',
                data: {
                    labels: etiquetas,
                    datasets: [
                        {
                            label: 'Vendidos por hora',
                            data: ventas,
                            backgroundColor: 'rgba(54, 162, 235, 0.3)',
                            borderColor: 'rgb(54, 235, 235)',
                            borderWidth: 2,
                            pointRadius: 2,
                            tension: 0.2
                        },
                        {
                            label: 'Comprados por hora',
                            data: compras,
                            backgroundColor: 'rgba(255, 206, 86, 0.3)',
                            borderColor: 'rgb(255, 168, 86)',
                            borderWidth: 2,
                            pointRadius: 2,
                            tension: 0.2
                        }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'top' },
                        title: { display: false }
                    }
                }
            });
        });
        tasks.push(() => {
            let tablaExistente = document.getElementById('mejores-table');
            if (tablaExistente) tablaExistente.remove();
            const tabla = document.createElement('table');
            tabla.className = 'table-modern';
            tabla.id = 'mejores-table';
            tabla.innerHTML = `
              <thead>
                <tr>
                  <th><div class="dato-item">Fecha/Hora</div></th>
                  <th><div class="dato-item">Vendidos</div></th>
                  <th><div class="dato-item">Comprados</div></th>
                  <th><div class="dato-item">Precio venta avg</div></th>
                  <th><div class="dato-item">Precio compra avg</div></th>
                </tr>
              </thead>
              <tbody>
                ${history.slice(-24).reverse().map(dato => {
                    let raw = dato.date || '';
                    let dateObj = raw ? new Date(raw) : null;
                    let fechaHora = dateObj && !isNaN(dateObj) ?
                        `${dateObj.getFullYear()}-${(dateObj.getMonth()+1).toString().padStart(2,'0')}-${dateObj.getDate().toString().padStart(2,'0')} ${dateObj.getHours().toString().padStart(2,'0')}:00` : raw;
                    return `<tr>
                      <td><div class="dato-item-info">${fechaHora}</div></td>
                      <td><div class="dato-item-info">${dato.sell_sold ?? ''}</div></td>
                      <td><div class="dato-item-info">${dato.buy_sold ?? ''}</div></td>
                      <td><div class="dato-item-info">${dato.sell_price_avg != null ? formatGoldColored(dato.sell_price_avg) : ''}</div></td>
                      <td><div class="dato-item-info">${dato.buy_price_avg != null ? formatGoldColored(dato.buy_price_avg) : ''}</div></td>
                    </tr>`;
                }).join('')}
              </tbody>
            `;
            const card = ventasComprasChartCtx.canvas.closest('.card');
            if (card) card.appendChild(tabla);
        });
        runIdleTasks(tasks);
    };
    ventasComprasWorker.postMessage({ history });
}

function mostrarHoraPunta(history) {
    const { horaPuntaDiv } = getMejoresHorasElements();
    if (!horaPuntaDiv) return;
    horaPuntaDiv.innerHTML = '';
    if (!history || history.length === 0) return;

    let maxTotal = -Infinity;
    let datoMax = null;
    history.forEach(d => {
        const total = (d.sell_sold || 0) + (d.buy_sold || 0);
        if (total > maxTotal) {
            maxTotal = total;
            datoMax = d;
        }
    });

    if (datoMax) {
        let fecha = datoMax.date || '';
        let dateObj = fecha ? new Date(fecha) : null;
        if (dateObj && !isNaN(dateObj)) {
            const yyyy = dateObj.getFullYear();
            const mm = (dateObj.getMonth()+1).toString().padStart(2,'0');
            const dd = dateObj.getDate().toString().padStart(2,'0');
            const hh = dateObj.getHours().toString().padStart(2,'0');
            fecha = `${yyyy}-${mm}-${dd} ${hh}:00`;
        }
        horaPuntaDiv.innerHTML = `<b>Hora punta:</b> ${fecha} &nbsp;|&nbsp; Vendidos: ${datoMax.sell_sold ?? '-'} &nbsp;|&nbsp; Comprados: ${datoMax.buy_sold ?? '-'}`;
    }
}
function mostrarPromedios(history) {
    const { promedioHoraDiv, promedioDiaDiv } = getMejoresHorasElements();
    if (!promedioHoraDiv || !promedioDiaDiv) return;
    promedioHoraDiv.innerHTML = '';
    promedioDiaDiv.innerHTML = '';
    if (!history || history.length === 0) return;

    let totalSell = 0;
    let totalBuy = 0;
    const dias = {};

    history.forEach(d => {
        const sell = d.sell_sold || 0;
        const buy = d.buy_sold || 0;
        totalSell += sell;
        totalBuy += buy;

        let fecha = d.date ? new Date(d.date) : null;
        if (fecha && !isNaN(fecha)) {
            const key = fecha.toISOString().split('T')[0];
            if (!dias[key]) dias[key] = { s:0, b:0 };
            dias[key].s += sell;
            dias[key].b += buy;
        }
    });

    const horas = history.length || 1;
    const numDias = Object.keys(dias).length || 1;

    const avgSellHora = totalSell / horas;
    const avgBuyHora = totalBuy / horas;
    const avgSellDia = totalSell / numDias;
    const avgBuyDia = totalBuy / numDias;

    promedioHoraDiv.innerHTML = `<div class="dato-item">Promedio por hora</div><div class="dato-item-info">Vendidos: ${avgSellHora.toFixed(1)} | Comprados: ${avgBuyHora.toFixed(1)}</div>`;
    promedioDiaDiv.innerHTML = `<div class="dato-item">Promedio por día</div><div class="dato-item-info">Vendidos: ${avgSellDia.toFixed(1)} | Comprados: ${avgBuyDia.toFixed(1)}</div>`;
}
