const assert = require('assert');
const path = require('path');

const modulePath = path.resolve(__dirname, '../../backend/api/index.js');

const { registerMockDeps } = require('../helpers/register-mock-deps.js');

function loadApiModule() {
  delete require.cache[modulePath];
  return require(modulePath);
}

const originalPort = process.env.API_PORT;
const originalHost = process.env.API_HOST;
const restoreDeps = registerMockDeps();

(async () => {
  try {
    delete process.env.API_PORT;
    delete process.env.API_HOST;
    let api = loadApiModule();
    let binding = api.__getServerBinding();
    assert.strictEqual(binding.port, 3300, 'default API_PORT should be 3300');
    assert.strictEqual(binding.host, '0.0.0.0', 'default API_HOST should be 0.0.0.0');

    process.env.API_PORT = '4400';
    process.env.API_HOST = '127.0.0.1';
    api = loadApiModule();
    binding = api.__getServerBinding();
    assert.strictEqual(binding.port, 4400, 'API_PORT env var should override default');
    assert.strictEqual(binding.host, '127.0.0.1', 'API_HOST env var should override default');

    console.log('tests/api/server-binding.test.js passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (originalPort === undefined) {
      delete process.env.API_PORT;
    } else {
      process.env.API_PORT = originalPort;
    }
    if (originalHost === undefined) {
      delete process.env.API_HOST;
    } else {
      process.env.API_HOST = originalHost;
    }
    delete require.cache[modulePath];
    if (typeof restoreDeps === 'function') {
      restoreDeps();
    }
  }
})();
