const fs = require('fs');
const path = require('path');

const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

function normalizeBaseUrl(value) {
  if (!value) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\/$/, '');
}

function loadManifest(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Manifest must be a JSON object');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Unable to read manifest at ${manifestPath}: ${err.message}`);
  }
}

function buildAssetUrlList(manifest, baseUrl) {
  const entries = new Set();
  Object.values(manifest || {}).forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const absolute = new URL(normalizedPath, `${baseUrl}/`).href;
    entries.add(absolute);
  });
  entries.add(new URL('/dist/manifest.json', `${baseUrl}/`).href);
  return Array.from(entries);
}

async function purgeBatch(zone, token, files) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ files }),
  });
  const payload = await response.json();
  if (!payload.success) {
    const message = payload.errors ? JSON.stringify(payload.errors) : response.statusText;
    throw new Error(message || 'Unknown CDN purge failure');
  }
}

async function purgeAssets(zone, token, assets) {
  const CHUNK_SIZE = 30;
  for (let index = 0; index < assets.length; index += CHUNK_SIZE) {
    const batch = assets.slice(index, index + CHUNK_SIZE);
    await purgeBatch(zone, token, batch);
    console.log(`Purged CDN batch ${Math.floor(index / CHUNK_SIZE) + 1}/${Math.ceil(assets.length / CHUNK_SIZE)}`);
  }
}

async function main() {
  if (process.env.SKIP_PURGE_CDN === '1' || process.env.SKIP_PURGE_CDN === 'true') {
    console.log('Skipping CDN purge');
    return;
  }

  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_TOKEN;
  const cdnBaseUrl = normalizeBaseUrl(process.env.CDN_BASE_URL);

  if (!zone || !token) {
    throw new Error('CLOUDFLARE_ZONE_ID and CLOUDFLARE_TOKEN env vars are required');
  }
  if (!cdnBaseUrl) {
    throw new Error('CDN_BASE_URL env var is required for selective invalidation');
  }

  const manifestPath = path.resolve(__dirname, '..', 'dist', 'manifest.json');
  const manifest = loadManifest(manifestPath);
  const assets = buildAssetUrlList(manifest, cdnBaseUrl);

  if (assets.length === 0) {
    console.log('No manifest assets detected, skipping CDN purge');
    return;
  }

  await purgeAssets(zone, token, assets);
  console.log(`CDN cache purged for ${assets.length} assets`);
}

main().catch((err) => {
  console.error('CDN purge failed', err);
  process.exit(1);
});
