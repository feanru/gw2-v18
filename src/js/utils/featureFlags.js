import { getConfig } from '../config.js';

const truthy = new Set(['1', 'true', 'yes', 'on']);
const falsy = new Set(['0', 'false', 'no', 'off']);

function toBool(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value == null) {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (truthy.has(normalized)) return true;
  if (falsy.has(normalized)) return false;
  return defaultValue;
}

function normalizeKey(key) {
  if (!key) return null;
  const normalized = String(key).trim().toLowerCase().replace(/[\-_]/g, '');
  switch (normalized) {
    case 'useprecomputed':
    case 'featureuseprecomputed':
    case 'precomputed':
    case 'precomputedon':
      return 'usePrecomputed';
    case 'donesaggregate':
    case 'featuredonesaggregate':
    case 'donesagg':
    case 'donesaggregated':
      return 'donesAggregate';
    default:
      return null;
  }
}

function parseOverrides(raw) {
  if (!raw) return {};
  const overrides = {};
  const chunks = Array.isArray(raw) ? raw : String(raw).split(',');
  for (const chunk of chunks) {
    if (!chunk) continue;
    let key = chunk;
    let value = 'true';
    if (typeof chunk === 'string') {
      const piece = chunk.trim();
      if (!piece) continue;
      if (piece.includes(':')) {
        const [k, v] = piece.split(':', 2).map((part) => part.trim());
        key = k;
        value = v;
      } else if (piece.includes('=')) {
        const [k, v] = piece.split('=', 2).map((part) => part.trim());
        key = k;
        value = v;
      } else {
        key = piece;
        value = 'true';
      }
    }
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) continue;
    overrides[normalizedKey] = toBool(value, true);
  }
  return overrides;
}

let cachedFlags = null;
let cachedUsePrecomputed = null;
let cachedDonesAggregate = null;

function getUsePrecomputedFlag() {
  if (cachedUsePrecomputed === null) {
    const { FEATURE_USE_PRECOMPUTED } = getConfig();
    cachedUsePrecomputed = toBool(FEATURE_USE_PRECOMPUTED, false);
  }
  return cachedUsePrecomputed;
}

function getDonesAggregateFlag() {
  if (cachedDonesAggregate === null) {
    const { FEATURE_DONES_AGGREGATE } = getConfig();
    cachedDonesAggregate = toBool(FEATURE_DONES_AGGREGATE, false);
  }
  return cachedDonesAggregate;
}

function computeFlags() {
  if (cachedFlags) {
    return cachedFlags;
  }

  const defaults = {
    usePrecomputed: getUsePrecomputedFlag(),
    donesAggregate: getDonesAggregateFlag(),
  };

  let overrides = {};
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const ffRaw = params.get('ff');
      overrides = parseOverrides(ffRaw);
    } catch (err) {
      // ignore query parsing errors
    }
  }

  cachedFlags = { ...defaults, ...overrides };
  return cachedFlags;
}

export function getFeatureFlags() {
  return { ...computeFlags() };
}

export function isFeatureEnabled(flag) {
  if (!flag) return false;
  const flags = computeFlags();
  return Boolean(flags[flag]);
}

export function resetFeatureFlags() {
  cachedFlags = null;
  cachedUsePrecomputed = null;
  cachedDonesAggregate = null;
}
