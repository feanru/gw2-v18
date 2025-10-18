import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fetchGuardPath = join(__dirname, '../src/js/utils/fetchGuard.js');
const fetchGuardUrl = pathToFileURL(fetchGuardPath).href;

async function withGuard(options = {}, runner) {
  const {
    mode: configMode,
    reportUrl,
    whitelist,
    useSendBeacon = true,
    location: providedLocation,
    origin: providedOrigin,
    window: windowOverride,
    secureConfig: providedSecureConfig,
  } = options;

  const previous = {
    fetch: globalThis.fetch,
    consoleWarn: console.warn,
    navigator: globalThis.navigator,
    Image: globalThis.Image,
    window: globalThis.window,
    location: globalThis.location,
    origin: globalThis.origin,
    reportError: globalThis.reportError,
    imageStore: globalThis.__FETCH_GUARD_REPORT_IMAGES__,
    runtimeConfig: globalThis.__RUNTIME_CONFIG__,
    secureRuntime: globalThis.__SECURE_RUNTIME_CONFIG__,
  };

  const fetchCalls = [];
  const stubResponse = { ok: true, scenario: String(configMode ?? 'default') };
  const stubFetch = (input, init) => {
    fetchCalls.push([input, init]);
    return Promise.resolve(stubResponse);
  };

  const warnMessages = [];
  console.warn = (...args) => {
    warnMessages.push(args);
  };

  const beaconCalls = [];
  if (useSendBeacon) {
    const baseNavigator = (previous.navigator && typeof previous.navigator === 'object')
      ? { ...previous.navigator }
      : {};
    baseNavigator.sendBeacon = (url, data) => {
      beaconCalls.push([url, data]);
      return true;
    };
    globalThis.navigator = baseNavigator;
  } else {
    globalThis.navigator = {};
  }

  const imageRequests = [];
  globalThis.Image = class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    set src(value) {
      this._src = value;
      imageRequests.push(value);
    }

    get src() {
      return this._src;
    }
  };

  const reportErrorCalls = [];
  globalThis.reportError = (...args) => {
    reportErrorCalls.push(args);
  };

  const location = providedLocation || { origin: 'https://gw2.test' };
  globalThis.location = location;

  if (providedOrigin !== undefined) {
    globalThis.origin = providedOrigin;
  }

  const runtimeConfig = {};
  if (configMode !== undefined) {
    runtimeConfig.FETCH_GUARD_MODE = configMode;
  }
  if (reportUrl !== undefined) {
    runtimeConfig.FETCH_GUARD_REPORT_URL = reportUrl;
  }
  if (whitelist !== undefined) {
    runtimeConfig.FETCH_GUARD_WHITELIST = whitelist;
  }

  const secureRuntimeConfig = {};
  if (providedSecureConfig && typeof providedSecureConfig === 'object') {
    Object.assign(secureRuntimeConfig, providedSecureConfig);
  }

  let windowValue;
  if (windowOverride === undefined) {
    windowValue = { location };
  } else {
    windowValue = windowOverride;
  }

  let runtimeTarget;
  if (windowValue && typeof windowValue === 'object') {
    if (!('location' in windowValue)) {
      windowValue.location = location;
    }
    runtimeTarget = windowValue;
    runtimeTarget.__RUNTIME_CONFIG__ = runtimeConfig;
  } else {
    runtimeTarget = globalThis;
    runtimeTarget.__RUNTIME_CONFIG__ = runtimeConfig;
  }

  const secureEntries = Object.keys(secureRuntimeConfig);
  if (secureEntries.length > 0) {
    runtimeTarget.__SECURE_RUNTIME_CONFIG__ = secureRuntimeConfig;
  } else if (Object.prototype.hasOwnProperty.call(runtimeTarget, '__SECURE_RUNTIME_CONFIG__')) {
    delete runtimeTarget.__SECURE_RUNTIME_CONFIG__;
  }

  if (windowValue === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = windowValue;
  }

  globalThis.fetch = stubFetch;

  delete globalThis.__GW2_FETCH_GUARD_INSTALLED__;
  delete globalThis.__FETCH_GUARD_REPORT_IMAGES__;

  const unhandled = [];
  const unhandledHandler = (reason) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', unhandledHandler);

  try {
    const moduleUrl = `${fetchGuardUrl}?test=${Date.now()}-${Math.random()}`;
    await import(moduleUrl);
    const guardFetch = globalThis.fetch;

    const context = {
      guardFetch,
      originalFetch: stubFetch,
      fetchCalls,
      stubResponse,
      warnMessages,
      beaconCalls,
      imageRequests,
      reportErrorCalls,
      unhandled,
    };

    await runner(context);
  } finally {
    process.off('unhandledRejection', unhandledHandler);

    if (previous.fetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previous.fetch;
    }

    console.warn = previous.consoleWarn;

    if (previous.navigator === undefined) {
      delete globalThis.navigator;
    } else {
      globalThis.navigator = previous.navigator;
    }

    if (previous.Image === undefined) {
      delete globalThis.Image;
    } else {
      globalThis.Image = previous.Image;
    }

    if (previous.window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previous.window;
    }

    if (previous.location === undefined) {
      delete globalThis.location;
    } else {
      globalThis.location = previous.location;
    }

    if (previous.origin === undefined) {
      delete globalThis.origin;
    } else {
      globalThis.origin = previous.origin;
    }

    if (previous.reportError === undefined) {
      delete globalThis.reportError;
    } else {
      globalThis.reportError = previous.reportError;
    }

    if (previous.imageStore === undefined) {
      delete globalThis.__FETCH_GUARD_REPORT_IMAGES__;
    } else {
      globalThis.__FETCH_GUARD_REPORT_IMAGES__ = previous.imageStore;
    }

    if (previous.runtimeConfig === undefined) {
      delete globalThis.__RUNTIME_CONFIG__;
    } else {
      globalThis.__RUNTIME_CONFIG__ = previous.runtimeConfig;
    }

    if (previous.secureRuntime === undefined) {
      delete globalThis.__SECURE_RUNTIME_CONFIG__;
    } else {
      globalThis.__SECURE_RUNTIME_CONFIG__ = previous.secureRuntime;
    }

    delete globalThis.__GW2_FETCH_GUARD_INSTALLED__;
  }
}

await withGuard({}, async ({
  guardFetch,
  stubResponse,
  fetchCalls,
  warnMessages,
}) => {
  const gw2ApiResponse = await guardFetch('https://api.guildwars2.com/v2/items/1?lang=es');
  assert.equal(gw2ApiResponse, stubResponse, 'GW2 API should be allowlisted by default');

  const marketResponse = await guardFetch('https://api.datawars2.ie/gw2/v1/items/csv?fields=id');
  assert.equal(marketResponse, stubResponse, 'Market API should be allowlisted by default');

  await assert.rejects(
    () => guardFetch('https://blocked.example/data'),
    (error) => {
      assert.equal(error.name, 'FetchGuardError');
      assert.equal(error.reason, 'External fetch detected');
      assert.equal(error.url, 'https://blocked.example/data');
      assert.match(error.message, /External fetch detected/);
      return true;
    },
    'default enforce mode should reject non-whitelisted origins',
  );

  assert.equal(fetchCalls.length, 2, 'only allowlisted requests should reach the original fetch by default');
  assert.equal(warnMessages.length, 1, 'blocked requests should trigger a warning by default');
});

await withGuard({
  mode: 'enforce',
  reportUrl: 'https://reports.example/enforce-mode',
  whitelist: ["'self'", '/api'],
}, async ({
  guardFetch,
  stubResponse,
  fetchCalls,
  warnMessages,
  beaconCalls,
}) => {
  const allowedResponse = await guardFetch('/api/ping');
  assert.equal(allowedResponse, stubResponse, 'enforce mode should respect local allowlist entries');
  assert.equal(fetchCalls.length, 1, 'allowlisted request should reach the original fetch in enforce mode');

  await assert.rejects(
    () => guardFetch('https://rogue.example/data'),
    (error) => {
      assert.equal(error.name, 'FetchGuardError');
      assert.equal(error.reason, 'External fetch detected');
      assert.equal(error.url, 'https://rogue.example/data');
      return true;
    },
    'enforce mode should reject non-whitelisted origins',
  );

  assert.equal(fetchCalls.length, 1, 'blocked enforce requests must not reach the original fetch');
  assert.equal(warnMessages.length, 1, 'enforce mode should log a warning when blocking');
  assert.equal(beaconCalls.length, 1, 'enforce mode should emit a report when a URL is configured');
  const [reportTarget, reportPayload] = beaconCalls[0];
  assert.equal(reportTarget, 'https://reports.example/enforce-mode');
  const payloadText = typeof reportPayload === 'string'
    ? reportPayload
    : await new Response(reportPayload).text();
  const payload = JSON.parse(payloadText);
  assert.equal(payload.mode, 'enforce');
  assert.equal(payload.reason, 'External fetch detected');
  assert.equal(payload.targetUrl, 'https://rogue.example/data');
});

await withGuard({
  secureConfig: {
    FETCH_GUARD_MODE: 'report-only',
  },
}, async ({
  guardFetch,
  stubResponse,
  fetchCalls,
  warnMessages,
}) => {
  const response = await guardFetch('https://blocked.example/data');
  assert.equal(response, stubResponse, 'secure override should downgrade the guard to report-only');
  assert.equal(fetchCalls.length, 1, 'report-only override should forward the request');
  assert.equal(warnMessages.length, 1, 'report-only override should still emit warnings');
  assert.match(String(warnMessages[0][0]), /External fetch detected/);
});

await withGuard({ mode: 'off', reportUrl: 'https://reports.example/off' }, async ({
  guardFetch,
  originalFetch,
  fetchCalls,
  stubResponse,
  warnMessages,
  beaconCalls,
  reportErrorCalls,
  unhandled,
}) => {
  assert.equal(typeof guardFetch, 'function');
  assert.equal(guardFetch.originalFetch, originalFetch);

  const response = await guardFetch('https://blocked.example/data');
  assert.equal(response, stubResponse, 'off mode should not alter the response');

  assert.equal(fetchCalls.length, 1, 'original fetch should be invoked in off mode');
  assert.equal(warnMessages.length, 0, 'off mode must not log warnings');
  assert.equal(beaconCalls.length, 0, 'off mode must not emit reports');
  assert.equal(reportErrorCalls.length, 0, 'reportError should never be used');
  assert.equal(unhandled.length, 0, 'off mode should not cause unhandled rejections');
});

await withGuard({
  mode: 'monitor',
  reportUrl: 'https://reports.example/report-only',
  whitelist: ['https://allowed.example'],
}, async ({
  guardFetch,
  originalFetch,
  fetchCalls,
  stubResponse,
  warnMessages,
  beaconCalls,
  imageRequests,
  reportErrorCalls,
  unhandled,
}) => {
  assert.equal(guardFetch.originalFetch, originalFetch);

  const allowedResponse = await guardFetch('https://allowed.example/data');
  assert.equal(allowedResponse, stubResponse, 'allowlisted domains should resolve normally');
  assert.equal(fetchCalls.length, 1, 'allowlisted fetch should reach the original implementation');
  assert.equal(warnMessages.length, 0, 'allowlisted fetch should not warn');

  const monitoredResponse = await guardFetch('https://legacy.example.com/backend/status');
  assert.equal(monitoredResponse, stubResponse, 'report-only mode must not block the request');
  assert.equal(fetchCalls.length, 2, 'report-only mode should call the original fetch');
  assert.equal(warnMessages.length, 1, 'report-only mode should log a warning');
  assert.match(String(warnMessages[0][0]), /Legacy backend fetch detected/, 'warning should mention the legacy backend');

  assert.equal(beaconCalls.length, 1, 'report-only mode should emit a report when configured');
  const [reportTarget, reportPayload] = beaconCalls[0];
  assert.equal(reportTarget, 'https://reports.example/report-only');
  const payloadText = typeof reportPayload === 'string'
    ? reportPayload
    : await new Response(reportPayload).text();
  const payload = JSON.parse(payloadText);
  assert.equal(payload.mode, 'report-only', 'payload should include the normalized mode');
  assert.equal(payload.reason, 'Legacy backend fetch detected');
  assert.equal(payload.targetUrl, 'https://legacy.example.com/backend/status');

  assert.equal(imageRequests.length, 0, 'sendBeacon should be preferred over the image fallback');
  assert.equal(reportErrorCalls.length, 0, 'reportError should not be called');
  assert.equal(unhandled.length, 0, 'report-only mode should not produce unhandled rejections');
});

await withGuard({
  mode: 'report-only',
  whitelist: [
    "'self'",
    'https://www.google-analytics.com',
    'https://www.googletagmanager.com',
  ],
}, async ({
  guardFetch,
  stubResponse,
  fetchCalls,
  warnMessages,
  beaconCalls,
}) => {
  const [selfResponse, analyticsResponse, tagManagerResponse] = await Promise.all([
    guardFetch('https://gw2.test/internal/status'),
    guardFetch('https://www.google-analytics.com/g/collect'),
    guardFetch('https://www.googletagmanager.com/gtm.js?id=GTM-1234'),
  ]);

  assert.equal(selfResponse, stubResponse, 'self origin should pass through the guard');
  assert.equal(analyticsResponse, stubResponse, 'explicitly whitelisted origins should pass');
  assert.equal(tagManagerResponse, stubResponse, 'tag manager origin should pass');

  const blockedResponse = await guardFetch('https://stats.google-analytics.com/collect');
  assert.equal(blockedResponse, stubResponse, 'report-only mode must not block non-whitelisted origins');

  assert.equal(fetchCalls.length, 4, 'all requests should reach the original fetch in report-only mode');
  assert.equal(warnMessages.length, 1, 'only non-whitelisted origins should trigger warnings');
  assert.match(String(warnMessages[0][0]), /External fetch detected/, 'blocked domain should emit an external warning');
  assert.equal(beaconCalls.length, 0, 'report-only mode without report URL should not emit reports');
});

await withGuard({
  mode: 'block',
  reportUrl: 'https://reports.example/enforce',
  useSendBeacon: false,
}, async ({
  guardFetch,
  originalFetch,
  fetchCalls,
  stubResponse,
  warnMessages,
  beaconCalls,
  imageRequests,
  reportErrorCalls,
  unhandled,
}) => {
  assert.equal(guardFetch.originalFetch, originalFetch);

  const allowedResponse = await guardFetch('/backend/api/allowed');
  assert.equal(allowedResponse, stubResponse, 'whitelisted backend routes should pass through');
  assert.equal(fetchCalls.length, 1, 'allowed request should call the original fetch');

  await assert.rejects(
    () => guardFetch('https://external.example/path'),
    (error) => {
      assert.equal(error.name, 'FetchGuardError');
      assert.equal(error.reason, 'External fetch detected');
      assert.equal(error.url, 'https://external.example/path');
      assert.match(error.message, /External fetch detected/);
      return true;
    },
    'enforce mode should reject blocked requests',
  );

  assert.equal(fetchCalls.length, 1, 'blocked requests must not reach the original fetch');
  assert.equal(warnMessages.length, 1, 'enforce mode should emit a warning');
  assert.match(String(warnMessages[0][0]), /External fetch detected/);

  assert.equal(beaconCalls.length, 0, 'fallback reporting should not use sendBeacon when unavailable');
  assert.ok(imageRequests.length >= 1, 'image fallback should be used when sendBeacon is missing');
  const fallbackUrl = imageRequests[0];
  const parsedUrl = new URL(fallbackUrl);
  assert.equal(`${parsedUrl.origin}${parsedUrl.pathname}`, 'https://reports.example/enforce');
  const payloadRaw = parsedUrl.searchParams.get('payload');
  assert.ok(payloadRaw, 'payload should be attached to the fallback request');
  const payload = JSON.parse(decodeURIComponent(payloadRaw));
  assert.equal(payload.mode, 'enforce');
  assert.equal(payload.reason, 'External fetch detected');
  assert.equal(payload.targetUrl, 'https://external.example/path');

  assert.equal(reportErrorCalls.length, 0, 'reportError should never be used');
  assert.equal(unhandled.length, 0, 'blocked promises must be handled without uncaught errors');
});

await withGuard({
  mode: 'report-only',
  whitelist: ["'self'"],
  location: { href: 'https://gw2.test/workers/recipe-tree/sw.js' },
}, async ({
  guardFetch,
  stubResponse,
  fetchCalls,
  warnMessages,
}) => {
  const [recipeTreeResponse, otherResponse] = await Promise.all([
    guardFetch('/recipe-tree/status.json'),
    guardFetch('https://gw2.test/metrics'),
  ]);

  assert.equal(recipeTreeResponse, stubResponse, 'recipe-tree path should be allowed without location.origin');
  assert.equal(otherResponse, stubResponse, 'derived origin should allow other same-origin requests');
  assert.equal(fetchCalls.length, 2, 'requests should reach the original fetch');
  assert.equal(warnMessages.length, 0, 'whitelisted requests must not produce warnings');
});

await withGuard({
  mode: 'report-only',
  whitelist: ["'self'"],
  location: { href: '/workers/recipe-tree/sw.js' },
}, async ({
  guardFetch,
  stubResponse,
  fetchCalls,
  warnMessages,
}) => {
  const allowedResponse = await guardFetch('/recipe-tree/data.json');
  assert.equal(allowedResponse, stubResponse, 'recipe-tree path should be allowed even without a resolvable origin');

  const monitoredResponse = await guardFetch('/not-allowed');
  assert.equal(monitoredResponse, stubResponse, 'non-whitelisted paths should still resolve in report-only mode');

  assert.equal(fetchCalls.length, 2, 'both requests should call the original fetch');
  assert.equal(warnMessages.length, 1, 'non-whitelisted path should trigger a warning');
  assert.match(String(warnMessages[0][0]), /Blocked fetch detected/, 'warning should mention the blocked fetch');
});

await withGuard({
  mode: 'enforce',
  whitelist: ["'self'", 'https://worker-allowed.example'],
  window: undefined,
}, async ({
  guardFetch,
  stubResponse,
  fetchCalls,
  warnMessages,
}) => {
  const [selfResponse, allowedResponse] = await Promise.all([
    guardFetch('https://gw2.test/internal/data'),
    guardFetch('https://worker-allowed.example/data.json'),
  ]);

  assert.equal(selfResponse, stubResponse, 'self origin should be allowed when enforcing in a worker');
  assert.equal(allowedResponse, stubResponse, 'worker runtime config should extend the whitelist');
  assert.equal(fetchCalls.length, 2, 'allowed requests should reach the original fetch in worker mode');

  await assert.rejects(
    () => guardFetch('https://blocked-worker.example/data'),
    (error) => {
      assert.equal(error.name, 'FetchGuardError');
      assert.equal(error.reason, 'External fetch detected');
      assert.equal(error.url, 'https://blocked-worker.example/data');
      assert.match(error.message, /External fetch detected/);
      return true;
    },
    'worker runtime config should switch the guard to enforce mode',
  );

  assert.equal(fetchCalls.length, 2, 'blocked worker requests must not reach the original fetch');
  assert.equal(warnMessages.length, 1, 'enforce mode in a worker should emit a warning for blocked requests');
});

console.log('fetch guard tests passed');
