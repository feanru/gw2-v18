'use strict';

const http = require('http');
const { URL } = require('url');
const {
  buildItemAggregate,
  getCachedAggregate,
  scheduleAggregateBuild,
  isAggregateExpired,
  DEFAULT_LANG,
} = require('../aggregates/buildItemAggregate');

const INTERNAL_HOST = process.env.INTERNAL_HOST || '0.0.0.0';
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT || process.env.PORT || 3200);

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function appendError(meta, message) {
  if (!meta) {
    return;
  }
  if (!Array.isArray(meta.errors)) {
    meta.errors = [];
  }
  if (message && !meta.errors.includes(message)) {
    meta.errors.push(message);
  }
}

async function handleAggregateRequest(req, res) {
  const parsedUrl = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' || parsedUrl.pathname !== '/internal/aggregate') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  const itemIdParam = parsedUrl.searchParams.get('itemId');
  const langParam = (parsedUrl.searchParams.get('lang') || DEFAULT_LANG).trim() || DEFAULT_LANG;
  const itemId = Number(itemIdParam);

  if (!Number.isFinite(itemId) || itemId <= 0) {
    sendJson(res, 400, { error: 'invalid itemId' });
    return;
  }

  try {
    const cached = await getCachedAggregate(itemId, langParam);
    if (!cached) {
      const fresh = await buildItemAggregate(itemId, langParam);
      sendJson(res, 200, { data: fresh.data, meta: { ...fresh.meta, stale: false } });
      return;
    }

    const expired = isAggregateExpired(cached.meta);
    if (expired) {
      scheduleAggregateBuild(itemId, langParam).catch(() => {});
    }
    const meta = { ...cached.meta, stale: expired || cached.meta.stale || false };
    sendJson(res, 200, { data: cached.data, meta });
  } catch (err) {
    const cached = await getCachedAggregate(itemId, langParam);
    if (cached) {
      const meta = { ...cached.meta, stale: true };
      appendError(meta, err && err.message ? String(err.message) : 'aggregate failed');
      sendJson(res, 200, { data: cached.data, meta });
      return;
    }
    sendJson(res, 503, { error: 'unable to compute aggregate' });
  }
}

function requestListener(req, res) {
  handleAggregateRequest(req, res).catch((err) => {
    console.error('[aggregate] unhandled error', err);
    sendJson(res, 500, { error: 'internal error' });
  });
}

module.exports = requestListener;
module.exports.handleAggregateRequest = handleAggregateRequest;

if (require.main === module) {
  const server = http.createServer(requestListener);
  server.listen(INTERNAL_PORT, INTERNAL_HOST, () => {
    console.log(
      `[aggregate] listening on http://${INTERNAL_HOST}:${INTERNAL_PORT}/internal/aggregate`,
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
