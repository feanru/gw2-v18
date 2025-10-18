/**
 * Centralized cache expiration policies (milliseconds).
 * 
 * - `item`: Item details from the GW2 API. These rarely change, so we cache indefinitely.
 * - `recipe`: Recipe data from the GW2 API. Also stable, cached indefinitely.
 * - `price`: Market price data. Fluctuates quickly, expires after 5 minutes.
 * - `history`: Hourly history data. Voluminous but relatively stable, expires after 24 hours.
 */
export const CACHE_TTLS = {
  item: null,
  recipe: null,
  price: 5 * 60 * 1000,
  history: 24 * 60 * 60 * 1000,
  bundle: 5 * 60 * 1000,
};

export default CACHE_TTLS;
