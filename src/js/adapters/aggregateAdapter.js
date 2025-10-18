const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export function toUiModel(json) {
  const source = isPlainObject(json) ? json : {};
  const data = isPlainObject(source.data) ? source.data : {};
  const metaSource = isPlainObject(source.meta) ? source.meta : {};

  const item = isPlainObject(data.item) ? { ...data.item } : null;

  let market = null;
  if (isPlainObject(data.market)) {
    market = { ...data.market };
  } else if (isPlainObject(data.totals)) {
    market = { ...data.totals };
  }

  const tree = data.tree != null ? data.tree : null;

  const meta = { ...metaSource };
  meta.stale = typeof metaSource.stale === 'boolean' ? metaSource.stale : false;
  meta.lang = typeof metaSource.lang === 'string' ? metaSource.lang : 'es';

  return {
    item,
    market,
    tree,
    meta,
  };
}

export default { toUiModel };
