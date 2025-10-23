const TELEMETRY_ENDPOINT = '/telemetry/web-vital';
const MAX_META_LENGTH = 256;

function clampString(value, maxLength = MAX_META_LENGTH) {
  if (typeof value !== 'string') {
    return value;
  }
  if (maxLength > 0 && value.length > maxLength) {
    return value.slice(0, maxLength);
  }
  return value;
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  const result = {};
  for (const [key, rawValue] of Object.entries(meta)) {
    if (rawValue == null) {
      continue;
    }
    if (typeof rawValue === 'number') {
      if (Number.isFinite(rawValue)) {
        result[key] = rawValue;
      }
      continue;
    }
    if (typeof rawValue === 'boolean') {
      result[key] = rawValue;
      continue;
    }
    const normalizedKey = clampString(String(key), 48);
    if (!normalizedKey) {
      continue;
    }
    result[normalizedKey] = clampString(String(rawValue));
  }
  return Object.keys(result).length ? result : undefined;
}

function buildPayload(metric) {
  if (!metric || typeof metric.name !== 'string') {
    return null;
  }
  const payload = {
    metric: metric.name,
    value: Number.isFinite(metric.value) ? Number(metric.value) : null,
    delta: Number.isFinite(metric.delta) ? Number(metric.delta) : null,
    rating: metric.rating || null,
    id: metric.id || null,
    isFinal: Boolean(metric.isFinal),
    navigationType: metric.navigationType || null,
    timestamp: new Date().toISOString(),
  };

  if (payload.value == null) {
    return null;
  }

  const navEntry = typeof performance !== 'undefined' && performance.getEntriesByType
    ? performance.getEntriesByType('navigation')[0]
    : null;
  if (!payload.navigationType && navEntry && navEntry.type) {
    payload.navigationType = navEntry.type;
  }

  if (typeof document !== 'undefined' && document.visibilityState) {
    payload.visibilityState = document.visibilityState;
  }
  if (typeof window !== 'undefined' && window.location) {
    payload.page = window.location.pathname || null;
  }
  if (typeof navigator !== 'undefined') {
    if (navigator.language) {
      payload.lang = navigator.language;
    }
    if (navigator.connection && navigator.connection.effectiveType) {
      payload.connection = navigator.connection.effectiveType;
    }
    if (typeof navigator.deviceMemory === 'number') {
      payload.deviceMemory = navigator.deviceMemory;
    }
  }

  const meta = normalizeMeta({
    visibility: payload.visibilityState,
    connection: payload.connection,
    deviceMemory: payload.deviceMemory,
    hardwareConcurrency:
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : undefined,
    eventTarget: metric.attribution && metric.attribution.eventTarget
      ? clampString(metric.attribution.eventTarget)
      : undefined,
    largestShiftType: metric.attribution && metric.attribution.largestShiftType
      ? clampString(metric.attribution.largestShiftType)
      : undefined,
    loadState: metric.attribution && metric.attribution.loadState
      ? clampString(metric.attribution.loadState)
      : undefined,
  });

  if (meta) {
    payload.meta = meta;
  }

  return payload;
}

const reportedMetricIds = new Set();

function shouldReport(metric) {
  if (!metric) {
    return false;
  }
  if (metric.name === 'TTFB') {
    return true;
  }
  return Boolean(metric.isFinal);
}

function sendPayload(payload) {
  if (!payload) {
    return;
  }
  const body = JSON.stringify(payload);
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(TELEMETRY_ENDPOINT, blob)) {
        return;
      }
    } catch (err) {
      // Fallback to fetch
    }
  }
  if (typeof fetch === 'function') {
    fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

function handleMetric(metric) {
  if (!shouldReport(metric)) {
    return;
  }
  const key = `${metric.name}:${metric.id}`;
  if (reportedMetricIds.has(key)) {
    return;
  }
  reportedMetricIds.add(key);
  const payload = buildPayload(metric);
  sendPayload(payload);
}

let registrationPromise = null;

function registerWebVitals() {
  if (registrationPromise) {
    return registrationPromise;
  }
  registrationPromise = import('web-vitals')
    .then((module) => {
      const { onCLS, onFID, onLCP, onINP, onTTFB } = module;
      const options = { reportAllChanges: true };
      try {
        if (typeof onCLS === 'function') {
          onCLS(handleMetric, options);
        }
        if (typeof onFID === 'function') {
          onFID(handleMetric);
        }
        if (typeof onLCP === 'function') {
          onLCP(handleMetric, options);
        }
        if (typeof onINP === 'function') {
          onINP(handleMetric, options);
        }
        if (typeof onTTFB === 'function') {
          onTTFB(handleMetric);
        }
      } catch (err) {
        if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
          console.warn('Error registering web-vitals listeners', err);
        }
      }
    })
    .catch((err) => {
      if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
        console.warn('No se pudo cargar web-vitals', err);
      }
    });
  return registrationPromise;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (!window.__DISABLE_WEB_VITALS__) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      registerWebVitals();
    } else {
      const boot = () => {
        registerWebVitals();
      };
      document.addEventListener('DOMContentLoaded', boot, { once: true });
      window.addEventListener('load', boot, { once: true });
    }
  }
}

export default registerWebVitals;
