import assert from 'assert';

const originalFetch = global.fetch;
const originalWindow = global.window;
const originalAbortController = global.AbortController;

if (typeof AbortController === 'undefined') {
  global.AbortController = class {
    constructor() {
      this.signal = { aborted: false, addEventListener() {} };
    }
    abort() {
      this.signal.aborted = true;
    }
  };
}

global.window = {
  __RUNTIME_CONFIG__: {
    API_BASE_URL: 'https://api.test',
    LANG: 'es',
    FALLBACK_LANGS: ['en'],
  },
};

function createResponse(status, body, headers = {}) {
  const normalizedHeaders = {};
  Object.entries(headers).forEach(([key, value]) => {
    normalizedHeaders[String(key).toLowerCase()] = value;
  });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return normalizedHeaders[String(name).toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
    clone() {
      return createResponse(status, body, headers);
    },
  };
}

const requests = [];

global.fetch = async (url) => {
  requests.push(url);
  const parsed = new URL(url);
  const ids = parsed.searchParams.get('ids');
  const lang = parsed.searchParams.get('lang');
  if (lang === 'es') {
    return createResponse(200, [
      { id: 101, icon: 'spanish-icon.png', rarity: 'Fine' },
    ]);
  }
  if (lang === 'en') {
    const requestedIds = ids.split(',').map((value) => Number(value));
    const payload = requestedIds.includes(102)
      ? [{ id: 102, icon: 'english-icon.png', rarity: 'Masterwork' }]
      : [];
    return createResponse(200, payload);
  }
  return createResponse(404, []);
};

const { requestItems, abortRequests } = await import('../src/js/utils/requestManager.js');
const { createIconFetcher } = await import('../src/js/search-modal-core.js');

const iconCache = {};
const rarityCache = {};
const warnings = [];

const fetchIconsFor = createIconFetcher({
  iconCache,
  rarityCache,
  requestItemsFn: requestItems,
  logger: { warn: (msg) => warnings.push(msg) },
});

const missing = await fetchIconsFor([101, 102]);

assert.deepStrictEqual(missing, [], 'Fallback should resolve both ids');
assert.strictEqual(iconCache[101]?.src, 'spanish-icon.png', 'Should keep Spanish icon');
assert.strictEqual(iconCache[101]?.isFallback, false, 'Spanish icon should not be marked as fallback');
assert.strictEqual(iconCache[102]?.src, 'english-icon.png', 'Should fill icon from English fallback');
assert.strictEqual(iconCache[102]?.isFallback, false, 'English fallback icon should not be marked as placeholder');
assert.strictEqual(rarityCache[102], 'Masterwork', 'Should persist rarity from fallback');

const fallbackRequest = requests.find((entry) => entry.includes('lang=en'));
assert.ok(fallbackRequest, 'Should issue fallback request in English');
const fallbackIds = new URL(fallbackRequest).searchParams.get('ids');
assert.strictEqual(fallbackIds, '102', 'Fallback request should only include missing ids');
assert.strictEqual(warnings.length, 0, 'No warnings expected when fallback succeeds');

abortRequests();

if (originalFetch) {
  global.fetch = originalFetch;
} else {
  delete global.fetch;
}
if (originalWindow) {
  global.window = originalWindow;
} else {
  delete global.window;
}
if (originalAbortController) {
  global.AbortController = originalAbortController;
} else {
  delete global.AbortController;
}

console.log('search-modal icon fallback test passed');
