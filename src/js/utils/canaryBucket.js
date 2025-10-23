const STORAGE_KEY = 'gw2.precomputed.bucket';
const ASSIGNMENTS_STORAGE_KEY = 'gw2.canary.assignments';
const MAX_BUCKET = 100;
const DEFAULT_SCOPE = 'default';

function readStorage(storage, key = STORAGE_KEY) {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage, key, value) {
  if (!storage) return;
  try {
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, String(value));
    }
  } catch {
    // ignore storage errors (quota, disabled, etc.)
  }
}

function clampBucket(value) {
  if (value == null) {
    return null;
  }
  const parsed = Number.isFinite(value) ? Number(value) : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const clamped = Math.floor(parsed);
  if (clamped < 0 || clamped >= MAX_BUCKET) {
    return null;
  }
  return clamped;
}

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

function sanitizeSegment(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  const separated = normalized
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-');
  const cleaned = separated
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || null;
}

function normalizeScopeKey(input = {}) {
  if (typeof input === 'string') {
    return normalizeScopeKey({ scope: input });
  }
  if (!input || typeof input !== 'object') {
    return DEFAULT_SCOPE;
  }

  const prefer = (value) => (typeof value === 'string' && value ? value : null);
  const feature = prefer(input.feature ?? input.flag ?? input.name ?? null);
  if (feature) {
    const segment = sanitizeSegment(feature);
    if (segment) {
      return `feature:${segment}`;
    }
  }

  const screen = prefer(input.screen ?? input.page ?? null);
  if (screen) {
    const segment = sanitizeSegment(screen);
    if (segment) {
      return `screen:${segment}`;
    }
  }

  const scope = prefer(input.scope);
  if (scope) {
    if (/^(feature|screen):/i.test(scope)) {
      const [prefix, rest] = scope.split(':', 2);
      const segment = sanitizeSegment(rest);
      if (segment) {
        return `${prefix.toLowerCase()}:${segment}`;
      }
      return null;
    }
    const segment = sanitizeSegment(scope);
    return segment || null;
  }

  return DEFAULT_SCOPE;
}

function resolveStorage() {
  if (typeof window !== 'undefined' && window && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function readAssignments(storage) {
  const raw = readStorage(storage, ASSIGNMENTS_STORAGE_KEY);
  if (!raw || typeof raw !== 'string') {
    return { version: 1, buckets: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { version: 1, buckets: {} };
    }
    const buckets = {};
    const sourceBuckets = parsed.buckets && typeof parsed.buckets === 'object' ? parsed.buckets : {};
    for (const [key, entry] of Object.entries(sourceBuckets)) {
      if (!key) {
        continue;
      }
      const bucketValue = typeof entry === 'object' && entry !== null ? entry.bucket : entry;
      const bucket = clampBucket(bucketValue);
      if (bucket == null) {
        continue;
      }
      const assignedAt = toIsoString(entry?.assignedAt ?? entry?.updatedAt ?? null);
      const expiresAt = toIsoString(entry?.expiresAt ?? null);
      const feature = entry?.feature ? sanitizeSegment(entry.feature) : null;
      const screen = entry?.screen ? sanitizeSegment(entry.screen) : null;
      buckets[key] = {
        bucket,
        assignedAt: assignedAt || null,
        expiresAt: expiresAt || null,
        source: entry?.source ? String(entry.source) : null,
        feature,
        screen,
      };
    }
    return {
      version: Number.isFinite(parsed.version) ? Number(parsed.version) : 1,
      buckets,
    };
  } catch {
    return { version: 1, buckets: {} };
  }
}

function writeAssignments(storage, assignments) {
  if (!storage) {
    return;
  }
  const payload = JSON.stringify(assignments);
  writeStorage(storage, ASSIGNMENTS_STORAGE_KEY, payload);
}

function ensureAssignments(storage) {
  const assignments = readAssignments(storage);
  if (!assignments.buckets || typeof assignments.buckets !== 'object') {
    assignments.buckets = {};
  }
  return assignments;
}

function parseLegacyBucket(storage) {
  const legacy = readStorage(storage, STORAGE_KEY);
  const bucket = clampBucket(legacy);
  return bucket;
}

function createAssignmentEntry(bucket, { source = null, feature = null, screen = null, now = new Date(), expiresAt = null } = {}) {
  const assignedAt = toIsoString(now) || null;
  return {
    bucket,
    assignedAt,
    expiresAt: expiresAt ? toIsoString(expiresAt) : null,
    source: source || null,
    feature: feature ? sanitizeSegment(feature) : null,
    screen: screen ? sanitizeSegment(screen) : null,
  };
}

function isEntryExpired(entry, nowTs) {
  if (!entry || !entry.expiresAt) {
    return false;
  }
  const expires = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expires)) {
    return false;
  }
  return nowTs > expires;
}

function cleanupExpired(assignments, nowTs) {
  let changed = false;
  for (const [key, entry] of Object.entries(assignments.buckets)) {
    if (isEntryExpired(entry, nowTs)) {
      delete assignments.buckets[key];
      changed = true;
    }
  }
  return changed;
}

function ensureDefaultAssignment(assignments, storage, nowTs) {
  const existing = assignments.buckets[DEFAULT_SCOPE];
  if (existing && !isEntryExpired(existing, nowTs)) {
    return existing;
  }

  const now = new Date(nowTs);
  const legacyBucket = clampBucket(parseLegacyBucket(storage));
  const bucket = legacyBucket ?? clampBucket(Math.floor(Math.random() * MAX_BUCKET));
  const entry = createAssignmentEntry(bucket, { source: legacyBucket != null ? 'legacy' : 'generated', now });
  assignments.buckets[DEFAULT_SCOPE] = entry;
  if (storage) {
    writeStorage(storage, STORAGE_KEY, bucket);
    writeAssignments(storage, assignments);
  }
  return entry;
}

function normalizeAssignmentInput(value) {
  if (value == null) {
    return [];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeAssignmentInput(parsed);
    } catch {
      const numeric = clampBucket(value);
      if (numeric != null) {
        return [{ scope: DEFAULT_SCOPE, bucket: numeric }];
      }
      return [];
    }
  }
  if (typeof value === 'number') {
    const numeric = clampBucket(value);
    return numeric != null ? [{ scope: DEFAULT_SCOPE, bucket: numeric }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeAssignmentInput(entry));
  }
  if (typeof value !== 'object') {
    return [];
  }

  const entries = [];
  const directKeys = ['default', 'global'];
  for (const directKey of directKeys) {
    if (Object.prototype.hasOwnProperty.call(value, directKey)) {
      const directValue = value[directKey];
      if (directValue && typeof directValue === 'object' && !Array.isArray(directValue)) {
        entries.push(...normalizeAssignmentInput({ scope: DEFAULT_SCOPE, ...directValue }));
      } else {
        entries.push(...normalizeAssignmentInput({ scope: DEFAULT_SCOPE, bucket: directValue }));
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'features')) {
    const features = value.features;
    if (features && typeof features === 'object') {
      for (const [featureKey, featureValue] of Object.entries(features)) {
        entries.push(...normalizeAssignmentInput({ feature: featureKey, ...(
          featureValue && typeof featureValue === 'object'
            ? featureValue
            : { bucket: featureValue }
        ) }));
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'screens') || Object.prototype.hasOwnProperty.call(value, 'pages')) {
    const pages = value.screens || value.pages;
    if (pages && typeof pages === 'object') {
      for (const [screenKey, screenValue] of Object.entries(pages)) {
        entries.push(...normalizeAssignmentInput({ screen: screenKey, ...(
          screenValue && typeof screenValue === 'object'
            ? screenValue
            : { bucket: screenValue }
        ) }));
      }
    }
  }

  const skipKeys = new Set([
    'features',
    'screens',
    'pages',
    'default',
    'global',
    'scope',
    'feature',
    'flag',
    'name',
    'screen',
    'page',
    'bucket',
    'value',
    'assignment',
    'assignedAt',
    'updatedAt',
    'expiresAt',
    'source',
    'remove',
  ]);

  for (const [key, rawValue] of Object.entries(value)) {
    if (skipKeys.has(key)) {
      continue;
    }
    entries.push(...normalizeAssignmentInput({ scope: key, ...(
      rawValue && typeof rawValue === 'object'
        ? rawValue
        : { bucket: rawValue }
    ) }));
  }

  const scope = normalizeScopeKey(value);
  const bucketCandidate = clampBucket(value.bucket ?? value.value ?? value.assignment ?? null);
  const remove = value.remove === true || value.bucket === null || value.value === null;
  if (remove && scope) {
    entries.push({ scope, remove: true });
  } else if (scope && bucketCandidate != null) {
    entries.push({
      scope,
      bucket: bucketCandidate,
      feature: value.feature ?? null,
      screen: value.screen ?? null,
      source: value.source ?? null,
      assignedAt: value.assignedAt ?? value.updatedAt ?? null,
      expiresAt: value.expiresAt ?? null,
    });
  }

  return entries;
}

export function syncAssignments(payload, { source = null, now = () => new Date() } = {}) {
  const storage = resolveStorage();
  const assignments = ensureAssignments(storage);
  const nowTs = now instanceof Date ? now.getTime() : Number(now);
  const timestamp = Number.isFinite(nowTs) ? nowTs : Date.now();
  let changed = cleanupExpired(assignments, timestamp);
  const updates = normalizeAssignmentInput(payload);
  if (!updates.length) {
    if (changed && storage) {
      writeAssignments(storage, assignments);
    }
    return assignments.buckets;
  }

  const nowDate = new Date(timestamp);
  const applied = new Set();
  for (const update of updates) {
    if (!update || !update.scope) {
      continue;
    }
    if (applied.has(update.scope)) {
      // Last write wins for the same scope within a single sync batch.
      delete assignments.buckets[update.scope];
    }
    applied.add(update.scope);
    if (update.remove) {
      if (assignments.buckets[update.scope]) {
        delete assignments.buckets[update.scope];
        changed = true;
      }
      continue;
    }
    const entry = createAssignmentEntry(update.bucket, {
      source: update.source || source || null,
      feature: update.feature || null,
      screen: update.screen || null,
      now: update.assignedAt ? new Date(update.assignedAt) : nowDate,
      expiresAt: update.expiresAt || null,
    });
    assignments.buckets[update.scope] = entry;
    if (update.scope === DEFAULT_SCOPE && storage) {
      writeStorage(storage, STORAGE_KEY, update.bucket);
    }
    changed = true;
  }

  if (changed && storage) {
    writeAssignments(storage, assignments);
  }

  return assignments.buckets;
}

export function getAssignments() {
  const storage = resolveStorage();
  const assignments = ensureAssignments(storage);
  const nowTs = Date.now();
  const changed = cleanupExpired(assignments, nowTs);
  if (changed && storage) {
    writeAssignments(storage, assignments);
  }
  const entries = {};
  for (const [key, value] of Object.entries(assignments.buckets)) {
    entries[key] = { ...value };
  }
  return entries;
}

export function getBucket(options = {}) {
  const storage = resolveStorage();
  const assignments = ensureAssignments(storage);
  const nowTs = Date.now();
  let changed = cleanupExpired(assignments, nowTs);
  const key = normalizeScopeKey(options) || DEFAULT_SCOPE;
  let entry = assignments.buckets[key];
  if (!entry || isEntryExpired(entry, nowTs)) {
    const defaultEntry = ensureDefaultAssignment(assignments, storage, nowTs);
    entry = key === DEFAULT_SCOPE ? defaultEntry : null;
  }
  if (!entry) {
    const defaultEntry = ensureDefaultAssignment(assignments, storage, nowTs);
    entry = defaultEntry;
  }
  if (changed && storage) {
    writeAssignments(storage, assignments);
  }
  return entry?.bucket ?? 0;
}

export {
  STORAGE_KEY,
  ASSIGNMENTS_STORAGE_KEY,
  MAX_BUCKET,
  DEFAULT_SCOPE,
  normalizeScopeKey,
};
