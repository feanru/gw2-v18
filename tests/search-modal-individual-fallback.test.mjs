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
  const parsed = new URL(url);
  if (parsed.pathname === '/items' && parsed.searchParams.get('ids') === '101,102') {
    return createResponse(200, [
      { id: 101, icon: 'primary-icon.png', rarity: 'Fine' },
    ]);
  }
  if (parsed.pathname === '/items' && parsed.searchParams.get('ids') === '201') {
    return createResponse(200, [
      {
        data: {
          item: { id: 201, icon: 'wrapped-icon.png', rarity: 'Rare' },
        },
        meta: {
          lang: 'es',
          source: 'node-backend',
        },
      },
    ]);
  }
  if (parsed.pathname === '/items/102') {
    return createResponse(200, {
      id: 102,
      icon: 'fallback-icon.png',
      rarity: 'Masterwork',
      fallback: true,
    }, {
      'ETag': 'W/"etag-102"',
    });
  }
  return createResponse(404, {});
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
    const warnings = [];

    const fetchIconsFor = createIconFetcher({
      iconCache,
      rarityCache,
      requestItemsFn: requestItems,
      logger: { warn: (msg) => warnings.push(msg) },
    });

    const missing = await fetchIconsFor([101, 102]);

    assert.deepStrictEqual(missing, [], 'Individual fallback should resolve missing ids');
    assert.strictEqual(iconCache[101]?.src, 'primary-icon.png', 'Primary icon should be cached');
    assert.strictEqual(iconCache[102]?.src, 'fallback-icon.png', 'Fallback fetch should populate icon');
    assert.strictEqual(iconCache[102]?.isFallback, false, 'Fallback fetch should mark icon as available');
    assert.strictEqual(rarityCache[102], 'Masterwork', 'Fallback fetch should persist rarity');
    assert.strictEqual(warnings.length, 0, 'No warnings expected after individual fallback');

    assert.ok(requests.some((entry) => entry.includes('/items?ids=101,102')),
      'Should perform initial batch request');
    assert.ok(requests.some((entry) => entry.includes('/items/102?lang=es')),
      'Should perform individual fallback request for missing id');

    const missingWrapped = await fetchIconsFor([201]);
    assert.deepStrictEqual(missingWrapped, [], 'Wrapped response should resolve without missing ids');
    assert.strictEqual(iconCache[201]?.src, 'wrapped-icon.png', 'Wrapped backend response should normalize item icon');
    assert.strictEqual(iconCache[201]?.isFallback, false, 'Wrapped backend response should not mark icon as fallback');

    console.log('search-modal individual fallback test passed');
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
