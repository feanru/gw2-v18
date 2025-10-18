import assert from 'assert';
import { getCached, setCached, fetchDedup } from '../src/js/utils/cache.js';

// Node doesn't define btoa by default
if (typeof btoa === 'undefined') {
  global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}

class GuildWars2API {
  constructor() {
    this.ITEMS_ENDPOINT = 'https://api.guildwars2.com/v2/items';
    this.CACHE_PREFIX = 'gw2_api_cache_';
    this.CACHE_DURATION = 24 * 60 * 60 * 1000;
  }

  async _fetchWithCache(url, useCache = true) {
    const cacheKey = this.CACHE_PREFIX + btoa(url);
    if (useCache) {
      const cached = getCached(cacheKey);
      if (cached) return cached;
    }
    const response = await fetchDedup(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.clone().json();
    if (useCache) {
      setCached(cacheKey, data, this.CACHE_DURATION);
    }
    return data;
  }

  async getItemDetails(itemId) {
    const url = `${this.ITEMS_ENDPOINT}/${itemId}?lang=es`;
    return this._fetchWithCache(url);
  }
}

const gw2API = new GuildWars2API();

let fetchCalls = 0;
// Stub global fetch to simulate network request and allow cloning
global.fetch = async () => {
  fetchCalls++;
  // delay to ensure calls overlap
  await new Promise((r) => setTimeout(r, 10));
  return new Response(JSON.stringify({ id: 1, name: 'Test Item' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

const promises = [
  gw2API.getItemDetails(1),
  gw2API.getItemDetails(1),
  gw2API.getItemDetails(1),
  gw2API.getItemDetails(1)
];

const results = await Promise.all(promises);

// fetch should only be called once thanks to fetchDedup
assert.strictEqual(fetchCalls, 1);
// All calls should resolve with the mocked item
results.forEach((r) => assert.strictEqual(r.id, 1));

console.log('gw2API getItemDetails parallel test passed');
