const hasOwn = Object.prototype.hasOwnProperty;

function normalizeErrors(errors) {
  if (errors == null) return [];
  return Array.isArray(errors) ? errors : [errors];
}

export function normalizeApiResponse(payload) {
  if (payload == null) {
    return { data: null, meta: { errors: [] } };
  }

  if (typeof payload !== 'object' || payload instanceof Response) {
    return { data: payload, meta: { errors: [] } };
  }

  if (Array.isArray(payload)) {
    return { data: payload, meta: { errors: [] } };
  }

  if (hasOwn.call(payload, 'data')) {
    const meta = hasOwn.call(payload, 'meta') && typeof payload.meta === 'object'
      ? { ...payload.meta, errors: normalizeErrors(payload.meta?.errors) }
      : { errors: [] };
    return { data: payload.data, meta };
  }

  if (hasOwn.call(payload, 'meta')) {
    const meta = typeof payload.meta === 'object'
      ? { ...payload.meta, errors: normalizeErrors(payload.meta?.errors) }
      : { errors: [] };
    return { data: null, meta };
  }

  const { errors, ...rest } = payload;
  return { data: rest, meta: { errors: normalizeErrors(errors) } };
}

export function unwrapApiResponse(payload) {
  const { data } = normalizeApiResponse(payload);
  return data;
}
