const hasOwn = Object.prototype.hasOwnProperty;

function normalizeErrors(errors) {
  if (errors == null) return [];
  return Array.isArray(errors) ? errors : [errors];
}

function extractTraceId(meta, payload) {
  if (meta && typeof meta.traceId === 'string' && meta.traceId) {
    return meta.traceId;
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if (typeof payload.traceId === 'string' && payload.traceId) {
      return payload.traceId;
    }
    const candidate = payload.meta && typeof payload.meta === 'object' ? payload.meta.traceId : null;
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return null;
}

function withTrace(meta, payload) {
  const base = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : { errors: [] };
  if (!Array.isArray(base.errors)) {
    base.errors = normalizeErrors(base.errors);
  }
  const traceId = extractTraceId(base, payload);
  if (traceId) {
    base.traceId = traceId;
  } else if (!hasOwn.call(base, 'traceId')) {
    base.traceId = null;
  }
  return base;
}

function finalizeResponse(data, meta, payload) {
  return { data, meta: withTrace(meta, payload) };
}

export function normalizeApiResponse(payload) {
  if (payload == null) {
    return finalizeResponse(null, { errors: [] }, payload);
  }

  if (typeof payload !== 'object' || payload instanceof Response) {
    return finalizeResponse(payload, { errors: [] }, payload);
  }

  if (Array.isArray(payload)) {
    return finalizeResponse(payload, { errors: [] }, payload);
  }

  if (hasOwn.call(payload, 'data')) {
    const meta = hasOwn.call(payload, 'meta') && typeof payload.meta === 'object'
      ? { ...payload.meta, errors: normalizeErrors(payload.meta?.errors) }
      : { errors: [] };
    return finalizeResponse(payload.data, meta, payload);
  }

  if (hasOwn.call(payload, 'meta')) {
    const meta = typeof payload.meta === 'object'
      ? { ...payload.meta, errors: normalizeErrors(payload.meta?.errors) }
      : { errors: [] };
    return finalizeResponse(null, meta, payload);
  }

  const { errors, ...rest } = payload;
  return finalizeResponse(rest, { errors: normalizeErrors(errors) }, payload);
}

export function unwrapApiResponse(payload) {
  const { data } = normalizeApiResponse(payload);
  return data;
}
