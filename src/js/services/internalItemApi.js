import { normalizeApiResponse } from '../utils/apiResponse.js';

export function joinApiPath(baseUrl, path) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  const trimmedBase = base.replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  if (!trimmedBase) {
    return normalizedPath ? `/${normalizedPath}` : '/';
  }
  if (!normalizedPath) {
    return trimmedBase || '/';
  }
  return `${trimmedBase}/${normalizedPath}`;
}

function extractDataArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === 'object') {
    return Object.values(payload.data).filter((entry) => entry != null);
  }
  const normalized = normalizeApiResponse(payload);
  if (Array.isArray(normalized.data)) {
    return normalized.data;
  }
  return [];
}

export function mergeItemDetailsIntoMap(targetMap, payload) {
  if (!targetMap || typeof targetMap.set !== 'function') return 0;
  const entries = extractDataArray(payload);
  let applied = 0;
  entries.forEach((item) => {
    if (!item || typeof item.id !== 'number') return;
    targetMap.set(item.id, item);
    applied += 1;
  });
  return applied;
}

export function mergeMarketEntriesFromCsv(targetMap, csvText) {
  if (!targetMap || typeof targetMap.set !== 'function' || typeof csvText !== 'string') {
    return 0;
  }
  const trimmed = csvText.trim();
  if (!trimmed) return 0;
  const lines = trimmed.split('\n');
  if (lines.length <= 1) return 0;
  const headers = lines[0].split(',').map((header) => header.trim());
  let applied = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const values = line.split(',');
    const row = {};
    headers.forEach((header, idx) => {
      const value = values[idx];
      if (header === 'id') {
        row.id = value ? parseInt(value, 10) : null;
      } else if (header === 'buy_price' || header === 'sell_price') {
        row[header] = value !== '' && value !== undefined ? parseInt(value, 10) : null;
      } else {
        row[header] = value;
      }
    });
    if (row.id) {
      targetMap.set(row.id, {
        id: row.id,
        buy_price: Number.isFinite(row.buy_price) ? row.buy_price : null,
        sell_price: Number.isFinite(row.sell_price) ? row.sell_price : null,
      });
      applied += 1;
    }
  }
  return applied;
}

export function mergeMarketEntriesFromJson(targetMap, payload) {
  if (!targetMap || typeof targetMap.set !== 'function') return 0;
  const entries = extractDataArray(payload);
  let applied = 0;
  entries.forEach((entry) => {
    if (!entry) return;
    const id = Number.isFinite(entry.id) ? entry.id : Number.parseInt(entry.id, 10);
    if (!Number.isInteger(id) || id <= 0) return;
    const buy = entry.buy_price ?? entry.buys?.unit_price ?? null;
    const sell = entry.sell_price ?? entry.sells?.unit_price ?? null;
    targetMap.set(id, {
      id,
      buy_price: Number.isFinite(buy) ? buy : null,
      sell_price: Number.isFinite(sell) ? sell : null,
    });
    applied += 1;
  });
  return applied;
}
