const DEFAULT_VIEW = 'item.html';
const EVENT_BATCH_SIZE = 10;
const DURATION_SAMPLE_BATCH = 10;
const FLUSH_INTERVAL_MS = 5000;

const eventQueue = [];
const durationBuckets = new Map();
let flushTimerId = null;

function getNowTimestamp() {
  if (typeof Date !== 'undefined' && typeof Date.now === 'function') {
    return Date.now();
  }
  return 0;
}

function getHighResTime() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return getNowTimestamp();
}

function ensureTelemetrySink() {
  const root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!root) return null;
  if (!Array.isArray(root.__GW2_TELEMETRY__)) {
    root.__GW2_TELEMETRY__ = [];
  }
  return root.__GW2_TELEMETRY__;
}

function scheduleFlush() {
  if (flushTimerId) return;
  flushTimerId = setTimeout(() => {
    flushTelemetry({ force: true });
  }, FLUSH_INTERVAL_MS);
}

function percentile(sortedSamples, ratio) {
  if (!sortedSamples.length) return 0;
  const rank = Math.ceil(sortedSamples.length * ratio) - 1;
  const index = Math.min(sortedSamples.length - 1, Math.max(0, rank));
  return sortedSamples[index];
}

function hasPendingDurations() {
  for (const bucket of durationBuckets.values()) {
    if (bucket.samples.length > 0) {
      return true;
    }
  }
  return false;
}

function dequeueEventsIntoSink() {
  const sink = ensureTelemetrySink();
  if (!sink) {
    if (eventQueue.length || hasPendingDurations()) {
      scheduleFlush();
    }
    return;
  }
  while (eventQueue.length) {
    sink.push(eventQueue.shift());
  }
}

function collectDurationEvents({ force = false } = {}) {
  const now = getNowTimestamp();
  const durationEvents = [];

  for (const bucketData of durationBuckets.values()) {
    if (!bucketData.samples.length) continue;
    const shouldFlush = force
      || bucketData.samples.length >= DURATION_SAMPLE_BATCH
      || now - bucketData.lastUpdated >= FLUSH_INTERVAL_MS;
    if (!shouldFlush) continue;

    const sorted = [...bucketData.samples].sort((a, b) => a - b);
    const event = {
      view: DEFAULT_VIEW,
      bucket: bucketData.bucket,
      type: 'aggregatePerformance',
      timestamp: new Date().toISOString(),
      metrics: {
        count: sorted.length,
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99)
      },
      meta: {
        stale: bucketData.stale
      }
    };

    durationEvents.push(event);
    bucketData.samples = [];
    bucketData.lastUpdated = now;
  }

  if (durationEvents.length) {
    eventQueue.push(...durationEvents);
  }
}

function enqueueEvent(event) {
  eventQueue.push(event);
  if (eventQueue.length >= EVENT_BATCH_SIZE) {
    flushTelemetry();
  } else {
    scheduleFlush();
  }
}

export function trackTelemetryEvent(event = {}) {
  const finalEvent = {
    view: event.view || DEFAULT_VIEW,
    bucket: event.bucket ?? null,
    type: event.type || 'custom',
    timestamp: event.timestamp || new Date().toISOString()
  };

  if (event.meta != null) {
    finalEvent.meta = event.meta;
  }
  if (event.metrics != null) {
    finalEvent.metrics = event.metrics;
  }
  if (event.tags != null) {
    finalEvent.tags = event.tags;
  }
  if (event.error != null) {
    finalEvent.error = event.error;
  }

  enqueueEvent(finalEvent);
  return finalEvent;
}

export function recordAggregateDuration({ bucket = null, stale = null, duration }) {
  if (!Number.isFinite(duration) || duration < 0) return;
  const normalizedBucket = Number.isFinite(bucket) ? Number(bucket) : bucket;
  const normalizedStale = stale == null ? null : Boolean(stale);
  const staleKey = normalizedStale === null ? 'u' : (normalizedStale ? '1' : '0');
  const key = `${normalizedBucket ?? 'unknown'}|${staleKey}`;
  let bucketData = durationBuckets.get(key);
  if (!bucketData) {
    bucketData = {
      bucket: normalizedBucket ?? null,
      stale: normalizedStale,
      samples: [],
      lastUpdated: getNowTimestamp()
    };
    durationBuckets.set(key, bucketData);
  }

  bucketData.samples.push(duration);
  bucketData.lastUpdated = getNowTimestamp();

  if (bucketData.samples.length >= DURATION_SAMPLE_BATCH) {
    flushTelemetry();
  } else {
    scheduleFlush();
  }
}

export function flushTelemetry({ force = false } = {}) {
  if (flushTimerId) {
    clearTimeout(flushTimerId);
    flushTimerId = null;
  }

  collectDurationEvents({ force });
  dequeueEventsIntoSink();

  if (!force && (eventQueue.length || hasPendingDurations())) {
    scheduleFlush();
  }
}

export function now() {
  return getHighResTime();
}

