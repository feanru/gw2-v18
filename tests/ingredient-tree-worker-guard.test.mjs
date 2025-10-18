import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workerPath = join(__dirname, '../src/js/workers/ingredientTreeWorker.js');
const workerUrl = `${pathToFileURL(workerPath).href}?test=${Date.now()}-${Math.random()}`;

const previous = {
  fetch: globalThis.fetch,
  consoleWarn: console.warn,
  navigator: globalThis.navigator,
  Image: globalThis.Image,
  self: globalThis.self,
  location: globalThis.location,
  window: globalThis.window,
};

const warnings = [];
console.warn = (...args) => {
  warnings.push(args.join(' '));
};

const stubFetch = async () => ({ ok: true });
globalThis.fetch = stubFetch;

globalThis.navigator = {
  sendBeacon: () => true,
};

globalThis.Image = class MockImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }

  set src(value) {
    this._src = value;
  }

  get src() {
    return this._src;
  }
};

const location = { origin: 'https://gw2.test' };
globalThis.location = location;

globalThis.window = undefined;

globalThis.self = {
  location,
  postMessage: () => {},
};

try {
  await import(workerUrl);

  assert.equal(typeof globalThis.self.onmessage, 'function', 'worker should register onmessage handler');

  await globalThis.self.onmessage({
    data: {
      type: 'runtimeConfig',
      config: {},
    },
  });

  const runtimeConfig = globalThis.self.__RUNTIME_CONFIG__;
  assert.ok(runtimeConfig, 'runtime config should be applied');
  assert.equal(runtimeConfig.FETCH_GUARD_MODE, 'report-only');
  assert.ok(Array.isArray(runtimeConfig.FETCH_GUARD_WHITELIST));
  assert.deepEqual(runtimeConfig.FETCH_GUARD_WHITELIST, [
    'self',
    '/recipe-tree',
    'https://www.google-analytics.com',
    'https://region1.google-analytics.com',
    'https://www.googletagmanager.com',
  ]);

  const guardedFetch = globalThis.fetch;
  assert.notEqual(guardedFetch, stubFetch, 'fetch should be wrapped by guard');

  await guardedFetch('/recipe-tree/123');

  assert.equal(warnings.length, 0, 'guard should not warn for /recipe-tree path');

  await guardedFetch('https://cdn.jsdelivr.net/foo.js');

  assert.equal(warnings.length, 1, 'guard should warn for domains outside the allowlist');
  assert.ok(warnings[0].includes('[fetchGuard]'), 'warning should include fetchGuard prefix');
} finally {
  if (previous.fetch === undefined) {
    delete globalThis.fetch;
  } else {
    globalThis.fetch = previous.fetch;
  }

  if (previous.consoleWarn === undefined) {
    delete console.warn;
  } else {
    console.warn = previous.consoleWarn;
  }

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

  if (previous.self === undefined) {
    delete globalThis.self;
  } else {
    globalThis.self = previous.self;
  }

  if (previous.location === undefined) {
    delete globalThis.location;
  } else {
    globalThis.location = previous.location;
  }

  if (previous.window === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previous.window;
  }
}
