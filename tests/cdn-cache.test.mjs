import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

function computeEtag(buffer) {
  const hash = crypto.createHash('sha1').update(buffer).digest('hex');
  return `"${hash}-${buffer.length}"`;
}

function createCdnServer(rootDir) {
  return http.createServer((req, res) => {
    (async () => {
      if (!req.url) {
        res.statusCode = 400;
        res.end('bad request');
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const relativePath = pathname.replace(/^\/+/, '');
      const resolvedPath = path.join(rootDir, relativePath);
      const normalized = path.normalize(resolvedPath);
      if (!normalized.startsWith(rootDir)) {
        res.statusCode = 403;
        res.end('forbidden');
        return;
      }
      const data = await fs.readFile(normalized);
      const etag = computeEtag(data);
      const ext = path.extname(normalized).toLowerCase();
      const contentType = ext === '.js' || ext === '.mjs'
        ? 'application/javascript'
        : 'application/octet-stream';
      res.writeHead(200, {
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: etag,
        'Content-Length': data.length,
        'Content-Type': contentType,
      });
      res.end(data);
    })().catch((err) => {
      if (err && err.code === 'ENOENT') {
        res.statusCode = 404;
        res.end('not found');
      } else {
        res.statusCode = 500;
        res.end(err ? err.message : 'error');
      }
    });
  });
}

async function prepareAssets() {
  const manifestPath = path.join(distDir, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const entries = new Map();
  Object.values(manifest || {}).forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const relative = normalized.replace(/^\//, '');
    if (!relative.startsWith('dist/')) {
      return;
    }
    entries.set(normalized, relative);
  });
  if (entries.size === 0) {
    throw new Error('Manifest does not contain versioned assets');
  }
  const assets = [];
  for (const [publicPath, relative] of entries.entries()) {
    const fullPath = path.join(repoRoot, relative);
    const fileBuffer = await fs.readFile(fullPath);
    assets.push({
      publicPath,
      fileBuffer,
      expectedEtag: computeEtag(fileBuffer),
    });
  }
  return assets;
}

async function main() {
  const assets = await prepareAssets();
  const server = createCdnServer(repoRoot);
  const port = await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Unable to determine CDN server port'));
        return;
      }
      resolve(address.port);
    });
    server.on('error', reject);
  });

  const origin = `http://127.0.0.1:${port}`;
  try {
    for (const asset of assets) {
      const response = await fetch(new URL(asset.publicPath, origin));
      assert.strictEqual(
        response.status,
        200,
        `Expected 200 for ${asset.publicPath}, received ${response.status}`,
      );
      const cacheControl = response.headers.get('cache-control');
      assert.strictEqual(
        cacheControl,
        'public, max-age=31536000, immutable',
        `Unexpected Cache-Control for ${asset.publicPath}: ${cacheControl}`,
      );
      const etag = response.headers.get('etag');
      assert.ok(etag, `Missing ETag for ${asset.publicPath}`);
      assert.strictEqual(
        etag,
        asset.expectedEtag,
        `ETag mismatch for ${asset.publicPath}`,
      );
    }
    console.log('tests/cdn-cache.test.mjs passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
