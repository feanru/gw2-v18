const assert = require('assert');

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
    FALLBACK_LANGS: [],
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
  return createResponse(200, [
    {
      id: 200,
      icon: 'icon-200.png',
      rarity: 'Rare',
      sell_price: null,
    },
  ]);
};

(async () => {
  let abortRequestsRef = null;
  try {
    const requestModule = await import('../src/js/utils/requestManager.js');
    abortRequestsRef = requestModule.abortRequests;
    const { requestItems } = requestModule;
    const { createIconFetcher } = await import('../src/js/search-modal-core.js');

    const iconCache = {};
    const rarityCache = {};

    const fetchIconsFor = createIconFetcher({
      iconCache,
      rarityCache,
      requestItemsFn: requestItems,
      logger: null,
    });

    const missing = await fetchIconsFor(['200']);

    assert.deepStrictEqual(missing, [], 'Should resolve icon for normalized id');
    assert.ok(iconCache[200], 'Icon entry should be cached');
    assert.strictEqual(iconCache[200].src, 'icon-200.png', 'Icon should be cached using numeric id');
    assert.strictEqual(iconCache[200].isFallback, false, 'Icon entry should not be marked as fallback');
    assert.strictEqual(requests.length, 1, 'Should perform a single request');
    assert.strictEqual(rarityCache[200], 'Rare', 'Should store rarity for normalized id');

    console.log('search-modal core normalization test passed');
  } finally {
    if (abortRequestsRef) {
      abortRequestsRef();
    }
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
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
