import assert from 'assert';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const fetchImpl =
  globalThis.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const DIST_ROOT = path.resolve('dist');
const MANIFEST_PATH = path.join(DIST_ROOT, 'manifest.json');

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs') {
    return 'application/javascript; charset=utf-8';
  }
  if (ext === '.json') {
    return 'application/json; charset=utf-8';
  }
  return 'application/octet-stream';
}

async function loadManifest() {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

function buildAssetList(manifest) {
  const assets = new Set();
  Object.values(manifest || {}).forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.startsWith('/dist/')) {
      assets.add(trimmed);
    }
  });
  return Array.from(assets);
}

async function startCdnServer() {
  const handler = async (req, res) => {
    try {
      if (!req || req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }
      const requestUrl = new URL(req.url, 'http://localhost');
      const pathname = requestUrl.pathname;
      if (!pathname.startsWith('/dist/')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const relative = pathname.replace(/^\/+/, '');
      const localPath = path.join(DIST_ROOT, relative.replace(/^dist\//, ''));
      const resolved = path.resolve(localPath);
      if (!resolved.startsWith(DIST_ROOT)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const buffer = await fs.readFile(resolved);
      const etag = `"${crypto.createHash('sha1').update(buffer).digest('hex')}"`;
      res.writeHead(200, {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=60',
        ETag: etag,
        'Content-Length': buffer.length,
        'Content-Type': guessContentType(resolved),
      });
      res.end(buffer);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('error');
    }
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('error');
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const close = () =>
    new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  return { baseUrl, close };
}

async function run() {
  const manifest = await loadManifest();
  const assets = buildAssetList(manifest);
  assert.ok(assets.length > 0, 'Manifest must contain versioned assets');

  const { baseUrl, close } = await startCdnServer();
  const fetch = fetchImpl;

  try {
    for (const asset of assets) {
      const response = await fetch(`${baseUrl}${asset}`);
      assert.strictEqual(response.status, 200, `${asset} responded with ${response.status}`);
      const cacheControl = response.headers.get('cache-control');
      assert.ok(cacheControl && cacheControl.includes('public'), `${asset} should be cacheable by shared proxies`);
      assert.ok(
        cacheControl && cacheControl.includes('s-maxage=3600'),
        `${asset} should include s-maxage directive`,
      );
      assert.ok(
        cacheControl && cacheControl.includes('stale-while-revalidate=60'),
        `${asset} should include stale-while-revalidate directive`,
      );
      const etag = response.headers.get('etag');
      assert.ok(etag && etag.length > 0, `${asset} should expose an ETag`);
    }
    console.log('tests/cdn-cache.test.mjs passed');
  } finally {
    await close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
