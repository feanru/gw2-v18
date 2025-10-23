'use strict';

const DEFAULT_ASSIGNMENTS_KEY =
  (process.env.CANARY_ASSIGNMENTS_KEY && process.env.CANARY_ASSIGNMENTS_KEY.trim())
    || 'deploy:canaryAssignments';
const MAX_BUCKET = 100;

function toIsoString(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? parsed.toISOString() : null;
}

function clampBucket(value) {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.floor(numeric);
  if (rounded < 0 || rounded >= MAX_BUCKET) {
    return null;
  }
  return rounded;
}

function sanitizeSegment(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const cleaned = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || null;
}

function normalizeScopeKey(input) {
  if (!input) {
    return 'default';
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return 'default';
    }
    if (/^(feature|screen):/i.test(trimmed)) {
      const [prefix, rest] = trimmed.split(':', 2);
      const segment = sanitizeSegment(rest);
      return segment ? `${prefix.toLowerCase()}:${segment}` : null;
    }
    const segment = sanitizeSegment(trimmed);
    return segment || null;
  }
  if (typeof input !== 'object') {
    return 'default';
  }
  if (typeof input.scope === 'string') {
    const normalized = normalizeScopeKey(input.scope);
    if (normalized) {
      return normalized;
    }
  }
  if (typeof input.feature === 'string' || typeof input.flag === 'string' || typeof input.name === 'string') {
    const value = input.feature ?? input.flag ?? input.name;
    const segment = sanitizeSegment(value);
    return segment ? `feature:${segment}` : null;
  }
  if (typeof input.screen === 'string' || typeof input.page === 'string') {
    const value = input.screen ?? input.page;
    const segment = sanitizeSegment(value);
    return segment ? `screen:${segment}` : null;
  }
  return 'default';
}

function normalizeAssignmentEntry(entry, now) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const scope = normalizeScopeKey(entry);
  if (!scope) {
    return null;
  }
  const remove = entry.remove === true || entry.bucket === null || entry.value === null;
  if (remove) {
    return { scope, remove: true };
  }
  const bucketCandidate = entry.bucket ?? entry.value ?? entry.assignment ?? entry.rollout ?? entry.weight;
  const bucket = clampBucket(bucketCandidate);
  if (bucket == null) {
    return null;
  }
  const assignedAt = toIsoString(entry.assignedAt ?? entry.updatedAt ?? now);
  const expiresAt = toIsoString(entry.expiresAt ?? entry.expiry ?? null);
  const feature = entry.feature ?? entry.flag ?? entry.name ?? null;
  const screen = entry.screen ?? entry.page ?? null;
  return {
    scope,
    bucket,
    assignedAt,
    expiresAt,
    source: entry.source ? String(entry.source) : null,
    feature: feature ? sanitizeSegment(feature) : null,
    screen: screen ? sanitizeSegment(screen) : null,
  };
}

function normalizeAssignmentsCollection(value, { now = new Date() } = {}) {
  const list = [];
  const map = {};
  const timestamp = now instanceof Date ? now : new Date(now);

  const push = (entry) => {
    if (!entry || !entry.scope) {
      return;
    }
    if (entry.remove) {
      delete map[entry.scope];
      return;
    }
    map[entry.scope] = entry;
  };

  const reservedKeys = new Set([
    'default',
    'features',
    'feature',
    'screens',
    'pages',
    'scopes',
    'assignments',
    'scope',
    'bucket',
    'value',
    'assignment',
    'rollout',
    'weight',
    'assignedAt',
    'updatedAt',
    'expiresAt',
    'expiry',
    'source',
    'remove',
    'featureName',
    'screenName',
    'flag',
    'name',
    'page',
  ]);

  const visit = (input, context = {}) => {
    if (input == null) {
      return;
    }
    if (typeof input === 'number' || typeof input === 'string') {
      const bucket = clampBucket(input);
      if (bucket != null) {
        const entry = normalizeAssignmentEntry({ scope: 'default', bucket }, timestamp);
        push(entry);
      }
      return;
    }
    if (Array.isArray(input)) {
      input.forEach((item) => visit(item, context));
      return;
    }
    if (typeof input !== 'object') {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'default')) {
      visit({ scope: 'default', bucket: input.default }, context);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'features')) {
      const features = input.features;
      if (features && typeof features === 'object') {
        for (const [key, raw] of Object.entries(features)) {
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            visit({ feature: key, ...raw }, context);
          } else {
            visit({ feature: key, bucket: raw }, context);
          }
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'screens') || Object.prototype.hasOwnProperty.call(input, 'pages')) {
      const screens = input.screens || input.pages;
      if (screens && typeof screens === 'object') {
        for (const [key, raw] of Object.entries(screens)) {
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            visit({ screen: key, ...raw }, context);
          } else {
            visit({ screen: key, bucket: raw }, context);
          }
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'scopes')) {
      const scopes = input.scopes;
      if (scopes && typeof scopes === 'object') {
        for (const [scopeName, raw] of Object.entries(scopes)) {
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            visit({ scope: scopeName, ...raw }, context);
          } else {
            visit({ scope: scopeName, bucket: raw }, context);
          }
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'assignments')) {
      visit(input.assignments, context);
    }

    const normalized = normalizeAssignmentEntry(input, timestamp);
    if (normalized) {
      push(normalized);
    }

    for (const [key, raw] of Object.entries(input)) {
      if (reservedKeys.has(key)) {
        continue;
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        visit({ scope: key, ...raw }, context);
      } else {
        visit({ scope: key, bucket: raw }, context);
      }
    }
  };

  visit(value);

  for (const [scope, entry] of Object.entries(map)) {
    list.push({ ...entry });
  }

  return { list, map };
}

async function fetchAssignmentsFromRedis(redis, { key = DEFAULT_ASSIGNMENTS_KEY, now = () => new Date() } = {}) {
  if (!redis || typeof redis.get !== 'function') {
    return { list: [], map: {}, raw: null };
  }
  let raw = null;
  try {
    raw = await redis.get(key);
  } catch (err) {
    return { list: [], map: {}, raw: null, error: err };
  }
  if (!raw) {
    return { list: [], map: {}, raw: null };
  }
  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeAssignmentsCollection(parsed, { now: now() });
    return { ...normalized, raw };
  } catch (err) {
    return { list: [], map: {}, raw, error: err };
  }
}

module.exports = {
  DEFAULT_ASSIGNMENTS_KEY,
  normalizeScopeKey,
  normalizeAssignmentsCollection,
  fetchAssignmentsFromRedis,
};
