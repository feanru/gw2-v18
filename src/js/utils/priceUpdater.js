import { preloadPrices } from './priceHelper.js';
import apiHealth from './apiHealth.js';

export function startPriceUpdater(ids = [], applyFn, interval = 60000) {
  if (!Array.isArray(ids) || ids.length === 0) return () => {};
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const delay = apiHealth.getBackoff();
    if (delay) await new Promise(res => setTimeout(res, delay));
    try {
      const map = await preloadPrices(ids);
      if (typeof applyFn === 'function') applyFn(map);
    } catch (e) {
      apiHealth.recordFailure();
    }
    if (!stopped) setTimeout(tick, interval);
  }

  tick();

  return () => { stopped = true; };
}

export default { startPriceUpdater };
