const assert = require('assert');
const { Readable } = require('stream');

process.env.NODE_ENV = 'test';

const api = require('../../backend/api/index.js');

function createMockResponse(context = {}) {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    __responseContext: { ...context },
    writeHead(statusCode, incomingHeaders) {
      this.statusCode = statusCode;
      Object.assign(this.headers, incomingHeaders);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

function createJsonRequest(body, overrides = {}) {
  const payload = JSON.stringify(body);
  const stream = new Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  stream.method = overrides.method || 'POST';
  stream.url = overrides.url || '/telemetry/js-error';
  stream.headers = {
    'content-type': 'application/json',
    ...(overrides.headers || {}),
  };
  stream.socket = overrides.socket || { remoteAddress: '192.0.2.10' };
  return stream;
}

async function run() {
  const recorded = [];
  api.__setJsErrorRecorder(async (event) => {
    recorded.push(event);
  });

  try {
    const request = createJsonRequest(
      {
        message: 'ReferenceError: boom',
        stack: 'ReferenceError: boom\n    at <anonymous>:1:2',
        line: 1,
        column: 2,
        source: 'app.js',
      },
      {
        headers: {
          'user-agent': 'jest-agent',
          referer: 'https://gw2.example/item.html',
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
        },
      },
    );
    const response = createMockResponse();

    await api.handleApiRequest(request, response);

    assert.strictEqual(response.statusCode, 202);
    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.data.accepted, 1);
    assert.strictEqual(recorded.length, 1);
    const event = recorded[0];
    assert.strictEqual(event.message, 'ReferenceError: boom');
    assert.ok(event.stack.includes('ReferenceError'));
    assert.strictEqual(event.userAgent, 'jest-agent');
    assert.strictEqual(event.referer, 'https://gw2.example/item.html');
    assert.strictEqual(event.ip, '203.0.113.9');
    assert.ok(event.fingerprint, 'fingerprint should be defined');
    assert.ok(event.occurredAt instanceof Date, 'occurredAt should be a Date');

    const invalidRequest = createJsonRequest({}, { headers: { 'user-agent': 'invalid' } });
    const invalidResponse = createMockResponse();
    await api.handleApiRequest(invalidRequest, invalidResponse);
    assert.strictEqual(invalidResponse.statusCode, 400);

    console.log('tests/api/js-error-collector.test.js passed');
  } finally {
    api.__resetJsErrorRecorder();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
