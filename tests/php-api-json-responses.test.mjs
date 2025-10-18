import assert from 'assert';
import { spawn } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(port, pathname, attempts = 5) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await httpRequest(port, pathname);
    } catch (error) {
      lastError = error;
      await wait(200);
    }
  }
  throw lastError;
}

function httpRequest(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '..');

  const backendPort = await getAvailablePort();
  const server = spawn('php', ['-S', `127.0.0.1:${backendPort}`, '-t', 'backend'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  try {
    // Give the PHP server a moment to boot.
    await wait(300);

    const endpoints = [
      { path: '/api/dataBundle.php', expectedStatus: 400 },
      { path: '/api/itemBundle.php', expectedStatus: 400 },
      { path: '/api/itemDetails.php', expectedStatus: 400 },
    ];

    for (const endpoint of endpoints) {
      const response = await requestWithRetry(backendPort, endpoint.path);
      assert.strictEqual(response.statusCode, endpoint.expectedStatus, `unexpected status for ${endpoint.path}`);
      const contentType = response.headers['content-type'];
      assert.ok(contentType, `missing content-type header for ${endpoint.path}`);
      assert.strictEqual(contentType.toLowerCase(), 'application/json; charset=utf-8', `content-type mismatch for ${endpoint.path}`);
      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch (error) {
        assert.fail(`invalid JSON body for ${endpoint.path}`);
      }
      assert.ok('meta' in payload, `meta missing for ${endpoint.path}`);
      assert.ok(payload.meta.traceId, `traceId missing for ${endpoint.path}`);
      assert.ok(payload.meta.ts, `ts missing for ${endpoint.path}`);
      assert.ok(!('errors' in payload.meta), `meta.errors should be absent for ${endpoint.path}`);
      assert.ok(Array.isArray(payload.errors), `errors should be an array for ${endpoint.path}`);
      assert.ok(payload.errors.length >= 1, `errors should not be empty for ${endpoint.path}`);
      for (const error of payload.errors) {
        assert.strictEqual(typeof error.code, 'string', `error.code should be string for ${endpoint.path}`);
        assert.ok(error.code.length > 0, `error.code should not be empty for ${endpoint.path}`);
        assert.strictEqual(typeof error.msg, 'string', `error.msg should be string for ${endpoint.path}`);
        assert.ok(error.msg.length > 0, `error.msg should not be empty for ${endpoint.path}`);
        assert.ok(!Object.prototype.hasOwnProperty.call(error, 'message'), `error.message should not exist for ${endpoint.path}`);
      }
      assert.ok(!response.body.includes('<'), `response should not contain HTML for ${endpoint.path}`);
    }
  } finally {
    server.kill();
  }

  const fixturePort = await getAvailablePort();
  const fixtureServer = spawn('php', ['-S', `127.0.0.1:${fixturePort}`, '-t', 'tests/php-api-fixtures'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  try {
    await wait(300);

    const successResponse = await requestWithRetry(fixturePort, '/json_ok.php');
    assert.strictEqual(successResponse.statusCode, 200, 'unexpected status for json_ok.php');
    const successPayload = JSON.parse(successResponse.body);
    assert.ok('data' in successPayload, 'data missing for json_ok.php');
    assert.ok('meta' in successPayload, 'meta missing for json_ok.php');
    assert.ok(!('errors' in successPayload), 'errors should be omitted when not provided');
    assert.ok(!('errors' in successPayload.meta), 'meta.errors should be absent on success without errors');

    const successWithErrors = await requestWithRetry(fixturePort, '/json_ok.php?withErrors=1');
    assert.strictEqual(successWithErrors.statusCode, 200, 'unexpected status for json_ok.php?withErrors=1');
    const payloadWithErrors = JSON.parse(successWithErrors.body);
    assert.ok(Array.isArray(payloadWithErrors.errors), 'errors should be present as array when provided');
    assert.strictEqual(payloadWithErrors.errors.length, 2, 'expected two errors in success payload');
    for (const error of payloadWithErrors.errors) {
      assert.strictEqual(typeof error.code, 'string', 'success error code should be string');
      assert.ok(error.code.length > 0, 'success error code should not be empty');
      assert.strictEqual(typeof error.msg, 'string', 'success error msg should be string');
      assert.ok(error.msg.length > 0, 'success error msg should not be empty');
      assert.ok(!Object.prototype.hasOwnProperty.call(error, 'message'), 'success error should not expose message property');
    }
    assert.ok(!('errors' in payloadWithErrors.meta), 'meta.errors should remain absent even when errors returned');

    const exceptionResponse = await requestWithRetry(fixturePort, '/throw_exception.php');
    assert.strictEqual(exceptionResponse.statusCode, 500, 'unexpected status for throw_exception.php');
    const exceptionContentType = exceptionResponse.headers['content-type'];
    assert.ok(exceptionContentType, 'missing content-type header for throw_exception.php');
    assert.strictEqual(exceptionContentType.toLowerCase(), 'application/json; charset=utf-8', 'content-type mismatch for throw_exception.php');
    const exceptionPayload = JSON.parse(exceptionResponse.body);
    assert.ok(Array.isArray(exceptionPayload.errors), 'errors array missing for throw_exception.php');
    assert.ok(exceptionPayload.errors.length >= 1, 'expected at least one error for throw_exception.php');
    assert.strictEqual(exceptionPayload.errors[0].code, 'error_unexpected', 'unexpected primary error code for throw_exception.php');
    assert.strictEqual(exceptionPayload.errors[0].msg, 'Unexpected error', 'unexpected primary error message for throw_exception.php');
    assert.ok(exceptionPayload.meta.traceId, 'traceId missing for throw_exception.php');
    assert.ok(!exceptionResponse.body.includes('<'), 'response should not contain HTML for throw_exception.php');

    const warningResponse = await requestWithRetry(fixturePort, '/trigger_error.php');
    assert.strictEqual(warningResponse.statusCode, 500, 'unexpected status for trigger_error.php');
    const warningContentType = warningResponse.headers['content-type'];
    assert.ok(warningContentType, 'missing content-type header for trigger_error.php');
    assert.strictEqual(warningContentType.toLowerCase(), 'application/json; charset=utf-8', 'content-type mismatch for trigger_error.php');
    const warningPayload = JSON.parse(warningResponse.body);
    assert.ok(Array.isArray(warningPayload.errors), 'errors array missing for trigger_error.php');
    assert.ok(warningPayload.errors.length >= 1, 'expected at least one error for trigger_error.php');
    assert.strictEqual(warningPayload.errors[0].code, 'error_unexpected', 'unexpected primary error code for trigger_error.php');
    assert.ok(warningPayload.meta.traceId, 'traceId missing for trigger_error.php');
    assert.ok(!warningResponse.body.includes('<'), 'response should not contain HTML for trigger_error.php');
  } finally {
    fixtureServer.kill();
  }

  console.log('php-api-json-responses.test.mjs passed');
})();
