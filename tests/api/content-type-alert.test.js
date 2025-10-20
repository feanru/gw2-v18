const assert = require('assert');
const api = require('../../backend/api/index.js');

process.env.NODE_ENV = 'test';

function createMockRequest(url, method = 'GET') {
  return {
    method,
    url,
    headers: {},
  };
}

function createMockResponse() {
  const headers = {};
  const listeners = {};
  return {
    statusCode: null,
    body: null,
    headers,
    on(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    writeHead(statusCode, incomingHeaders = {}) {
      this.statusCode = statusCode;
      Object.entries(incomingHeaders).forEach(([key, value]) => {
        headers[String(key).toLowerCase()] = value;
      });
      headers['content-type'] = 'text/html';
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()] ?? undefined;
    },
    end(payload) {
      this.body = payload;
      if (listeners.finish) {
        listeners.finish.forEach((fn) => {
          try {
            fn();
          } catch (err) {
            // ignore test listener failures
          }
        });
      }
      if (typeof this.resolve === 'function') {
        this.resolve();
      }
    },
  };
}

function dispatch(request, response) {
  return new Promise((resolve, reject) => {
    response.resolve = resolve;
    try {
      api(request, response);
    } catch (err) {
      reject(err);
    }
  });
}

(async () => {
  const alerts = [];
  api.__setOperationalAlertDispatcher(async (alert) => {
    alerts.push(alert);
  });

  const request = createMockRequest('/api/unknown');
  const response = createMockResponse();
  await dispatch(request, response);

  assert.strictEqual(response.statusCode, 404);
  assert.strictEqual(alerts.length, 1, 'should dispatch an alert when content-type is not JSON');
  const [alert] = alerts;
  assert.strictEqual(alert.type, 'apiContentTypeMismatch');
  assert.strictEqual(alert.route, '/api/unknown');
  assert.strictEqual(alert.method, 'GET');
  assert.strictEqual(alert.statusCode, 404);
  assert.strictEqual(alert.contentType, 'text/html');
  assert.ok(alert.message.includes('text/html'));

  api.__resetOperationalAlertDispatcher();

  console.log('tests/api/content-type-alert.test.js passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
