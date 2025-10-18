const renderers = new Map();
const visibility = new WeakMap();
const latestState = new Map();

const supportsIntersectionObserver = typeof IntersectionObserver !== 'undefined';

const observer = supportsIntersectionObserver
  ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const el = entry.target;
      visibility.set(el, entry.isIntersecting);
      if (entry.isIntersecting) {
        const id = el.dataset.stateId || el.dataset.path;
        if (!id) return;
        const list = renderers.get(id);
        if (!list) return;
        const item = list.find(r => r.el === el);
        const data = el._pendingState;
        if (item && data) {
          item.renderFn(data);
          el._pendingState = null;
        }
      }
    });
  })
  : null;

export function register(id, el, renderFn) {
  const key = String(id);
  el.dataset.stateId = key;
  let list = renderers.get(key);
  if (!list) {
    list = [];
    renderers.set(key, list);
  }
  list.push({ el, renderFn });
  if (observer) {
    observer.observe(el);
  } else {
    visibility.set(el, true);
    if (renderFn && latestState.has(key)) {
      renderFn(latestState.get(key));
      el._pendingState = null;
    }
  }
}

export function update(id, data) {
  const key = String(id);
  latestState.set(key, data);
  const list = renderers.get(key);
  if (!list) return;
  list.forEach(({ el, renderFn }) => {
    if (!observer) {
      if (renderFn) {
        renderFn(data);
        el._pendingState = null;
      }
      return;
    }
    if (visibility.get(el)) {
      renderFn && renderFn(data);
    } else {
      el._pendingState = data;
    }
  });
}
