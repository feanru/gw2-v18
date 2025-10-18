import fetchWithRetry from '../utils/fetchWithRetry.js';
import { normalizeApiResponse } from '../utils/apiResponse.js';

export async function fetchItemAggregate(itemId, { signal } = {}) {
  if (!Number.isFinite(Number(itemId)) || Number(itemId) <= 0) {
    throw new Error('ID de ítem inválido');
  }
  const id = Number(itemId);
  const response = await fetchWithRetry(`/api/items/${id}/aggregate`, { signal });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Respuesta no válida del agregado');
  }
  const raw = await response.json().catch(() => null);
  const { data, meta } = normalizeApiResponse(raw);
  return { data, meta, status: response.status };
}
