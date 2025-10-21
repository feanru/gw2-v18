import {
  toMeta,
  toPriceSummary,
  mergePriceSummaries,
} from './aggregateAdapter.js';

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export function fromEntry(entry) {
  return toPriceSummary(entry);
}

export function merge(primary, fallback) {
  return mergePriceSummaries(primary, fallback);
}

export function toUiModel(payload) {
  const source = isPlainObject(payload) ? payload : {};
  const meta = toMeta(source.meta);
  let prices;
  if (Array.isArray(source.data)) {
    prices = source.data.map((entry) => toPriceSummary(entry));
  } else if (isPlainObject(source.data)) {
    prices = toPriceSummary(source.data);
  } else if (source.data instanceof Map) {
    prices = new Map();
    source.data.forEach((value, key) => {
      prices.set(key, toPriceSummary(value));
    });
  } else {
    prices = toPriceSummary(source);
  }
  return { prices, meta };
}

export default { toUiModel, fromEntry, merge };
