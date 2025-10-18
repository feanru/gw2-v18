import assert from 'assert';

const originalFetch = global.fetch;
const originalWindow = global.window;
const originalAbortController = global.AbortController;
const originalConsoleWarn = console.warn;

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
    FETCH_GUARD_MODE: 'off',
  },
  location: {
    origin: 'https://app.test',
    href: 'https://app.test/',
  },
};

function createResponse(status, body, headers = {}, { json } = {}) {
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
      if (typeof json === 'function') {
        return json();
      }
      return body;
    },
    clone() {
      return createResponse(status, body, headers, { json });
    },
  };
}

const requests = [];

const htmlError = new SyntaxError('Unexpected token < in JSON');

global.fetch = async (url) => {
  requests.push(url);
  const parsed = new URL(url);
  if (parsed.pathname === '/items' && parsed.searchParams.get('ids') === '1,2') {
    return createResponse(200, [
      { id: 1, name: 'Valid item' },
    ], {
      'content-type': 'application/json; charset=utf-8',
    });
  }
  if (parsed.pathname === '/items/2') {
    return createResponse(200, '<html>error</html>', {
      'content-type': 'text/html',
    }, {
      json: async () => { throw htmlError; },
    });
  }
  return createResponse(404, null, {
    'content-type': 'application/json',
  });
};

(async () => {
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args);
    if (typeof originalConsoleWarn === 'function') {
      originalConsoleWarn.apply(console, args);
    }
  };

  let abortRequestsRef = null;
  try {
    const moduleUrl = new URL('../src/js/utils/requestManager.js', import.meta.url);
    const requestModule = await import(`${moduleUrl}?t=${Date.now()}`);
    abortRequestsRef = requestModule.abortRequests;
    const { requestItems } = requestModule;

    const [item1, item2] = await requestItems([1, 2]);

    assert.deepStrictEqual(item1, { id: 1, name: 'Valid item' }, 'Valid item should resolve from batch');
    assert.strictEqual(item2, null, 'Invalid HTML response should leave item unresolved');

    const warningMessages = warnings.map((entry) => entry[0] ?? '').join('\n');
    assert.ok(warningMessages.includes('unexpected content-type text/html'), 'Should warn about invalid content-type');

    assert.strictEqual(requests.filter((entry) => entry.includes('/items?ids=1,2')).length, 1,
      'Should perform a single batch request');
    assert.ok(requests.some((entry) => entry.includes('/items/2?lang=es')),
      'Should attempt fallback fetch for missing id');

    console.log('request manager content-type fallback test passed');
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
    console.warn = originalConsoleWarn;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
