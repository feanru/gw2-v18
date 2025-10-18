import assert from 'node:assert/strict';

function resetWindow() {
  if (typeof globalThis.window !== 'undefined') {
    delete globalThis.window;
  }
}

async function importFresh(specifier, tag) {
  return import(`${specifier}?test=${tag}&ts=${Date.now()}`);
}

async function run() {
  // Defaults when no window object exists
  resetWindow();
  const defaultsModule = await importFresh('../src/js/config.js', 'defaults');
  const defaultsConfig = defaultsModule.getConfig();
  assert.equal(defaultsConfig.API_BASE_URL, '/api');
  assert.equal(defaultsConfig.DEFAULT_LANG, 'es');
  assert.equal(defaultsConfig.LANG, 'es');
  assert.equal(defaultsConfig.priceCacheStrategy, 'sessionStorage');
  assert.equal(defaultsConfig.FEATURE_USE_PRECOMPUTED, false);
  assert.equal(defaultsConfig.FETCH_GUARD_MODE, 'report-only');
  assert.deepEqual(defaultsConfig.CONNECT_ALLOWLIST, []);
  assert.notEqual(defaultsConfig.CONNECT_ALLOWLIST, defaultsModule.DEFAULT_CONFIG.CONNECT_ALLOWLIST);
  assert.equal(defaultsConfig.FETCH_GUARD_REPORT_URL, null);

  // Legacy window.Config is respected when present
  resetWindow();
  globalThis.window = {
    Config: {
      API_BASE_URL: 'https://legacy.example/api',
      DEFAULT_LANG: 'de',
      priceCacheStrategy: 'redis',
      FEATURE_USE_PRECOMPUTED: 'true',
      FETCH_GUARD_MODE: 'block',
      CONNECT_ALLOWLIST: ['https://legacy.example'],
      FETCH_GUARD_REPORT_URL: 'https://legacy.example/report'
    }
  };
  const legacyModule = await importFresh('../src/js/config.js', 'legacy');
  const legacyConfig = legacyModule.getConfig();
  assert.equal(legacyConfig.API_BASE_URL, 'https://legacy.example/api');
  assert.equal(legacyConfig.DEFAULT_LANG, 'de');
  assert.equal(legacyConfig.LANG, 'de');
  assert.equal(legacyConfig.priceCacheStrategy, 'redis');
  assert.equal(legacyConfig.FEATURE_USE_PRECOMPUTED, true);
  assert.equal(legacyConfig.FETCH_GUARD_MODE, 'block');
  assert.deepEqual(legacyConfig.CONNECT_ALLOWLIST, ['https://legacy.example']);
  assert.notEqual(legacyConfig.CONNECT_ALLOWLIST, globalThis.window.Config.CONNECT_ALLOWLIST);
  assert.equal(legacyConfig.FETCH_GUARD_REPORT_URL, 'https://legacy.example/report');

  // Runtime configuration overrides window.Config
  resetWindow();
  globalThis.window = {
    Config: {
      API_BASE_URL: 'https://legacy.example/api',
      DEFAULT_LANG: 'de',
      priceCacheStrategy: 'redis',
      FEATURE_USE_PRECOMPUTED: false,
      FETCH_GUARD_MODE: 'block',
      CONNECT_ALLOWLIST: ['https://legacy.example'],
      FETCH_GUARD_REPORT_URL: 'https://legacy.example/report'
    },
    __RUNTIME_CONFIG__: {
      API_BASE_URL: 'https://runtime.example/api',
      DEFAULT_LANG: 'en',
      priceCacheStrategy: 'sessionStorage',
      FEATURE_USE_PRECOMPUTED: 'yes',
      FETCH_GUARD_MODE: 'monitor',
      CONNECT_ALLOWLIST: ['https://runtime.example'],
      FETCH_GUARD_REPORT_URL: null
    },
    __SECURE_RUNTIME_CONFIG__: {
      FETCH_GUARD_MODE: 'off',
      FETCH_GUARD_REPORT_URL: 'https://secure.example/report',
      FETCH_GUARD_WHITELIST: ['https://secure.example']
    }
  };
  const runtimeModule = await importFresh('../src/js/config.js', 'runtime');
  const runtimeConfig = runtimeModule.getConfig();
  assert.equal(runtimeConfig.API_BASE_URL, 'https://runtime.example/api');
  assert.equal(runtimeConfig.DEFAULT_LANG, 'en');
  assert.equal(runtimeConfig.LANG, 'en');
  assert.equal(runtimeConfig.priceCacheStrategy, 'sessionStorage');
  assert.equal(runtimeConfig.FEATURE_USE_PRECOMPUTED, true);
  assert.equal(runtimeConfig.FETCH_GUARD_MODE, 'off');
  assert.deepEqual(runtimeConfig.CONNECT_ALLOWLIST, ['https://runtime.example']);
  assert.notEqual(runtimeConfig.CONNECT_ALLOWLIST, globalThis.window.__RUNTIME_CONFIG__.CONNECT_ALLOWLIST);
  assert.equal(runtimeConfig.FETCH_GUARD_REPORT_URL, 'https://secure.example/report');
  assert.deepEqual(runtimeConfig.FETCH_GUARD_WHITELIST, ['https://secure.example']);

  // Secure runtime configuration should take precedence over legacy values when no runtime overrides exist
  resetWindow();
  globalThis.window = {
    Config: {
      FETCH_GUARD_MODE: 'monitor',
      FETCH_GUARD_REPORT_URL: 'https://legacy.example/report'
    },
    __SECURE_RUNTIME_CONFIG__: {
      FETCH_GUARD_MODE: 'block',
      FETCH_GUARD_REPORT_URL: 'https://secure.example/report-only'
    }
  };
  const secureOnlyModule = await importFresh('../src/js/config.js', 'secure-only');
  const secureOnlyConfig = secureOnlyModule.getConfig();
  assert.equal(secureOnlyConfig.FETCH_GUARD_MODE, 'block');
  assert.equal(secureOnlyConfig.FETCH_GUARD_REPORT_URL, 'https://secure.example/report-only');

  // Feature flag helper continues to honour FEATURE_USE_PRECOMPUTED
  resetWindow();
  globalThis.window = {
    __RUNTIME_CONFIG__: {
      FEATURE_USE_PRECOMPUTED: '1'
    },
    location: {
      search: ''
    }
  };
  const featureFlagsModule = await importFresh('../src/js/utils/featureFlags.js', 'flags');
  const { getFeatureFlags, isFeatureEnabled, resetFeatureFlags } = featureFlagsModule;
  assert.equal(getFeatureFlags().usePrecomputed, true);
  assert.equal(isFeatureEnabled('usePrecomputed'), true);

  globalThis.window.location.search = '?ff=usePrecomputed:false';
  resetFeatureFlags();
  assert.equal(isFeatureEnabled('usePrecomputed'), false);

  console.log('config runtime priority tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
