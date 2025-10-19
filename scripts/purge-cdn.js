const fs = require('fs');
const path = require('path');

const fetch =
  global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const shouldSkip = process.env.SKIP_PURGE_CDN === '1' || process.env.SKIP_PURGE_CDN === 'true';
if (shouldSkip) {
  console.log('Skipping CDN purge');
  process.exit(0);
}

const zone = process.env.CLOUDFLARE_ZONE_ID;
const token = process.env.CLOUDFLARE_TOKEN;
const cdnBaseEnv = (process.env.CDN_BASE_URL || '').trim();

if (!zone || !token) {
  console.error('CLOUDFLARE_ZONE_ID and CLOUDFLARE_TOKEN env vars are required');
  process.exit(1);
}

if (!cdnBaseEnv) {
  console.error('CDN_BASE_URL env var is required for selective CDN purges');
  process.exit(1);
}

const cdnBaseUrl = cdnBaseEnv.replace(/\/$/, '');
const manifestPath = path.join(__dirname, '..', 'dist', 'manifest.json');

function loadManifest(manifestFile) {
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`Manifest file not found at ${manifestFile}`);
  }
  const raw = fs.readFileSync(manifestFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse manifest: ${err.message}`);
  }
}

function buildPurgePathSet(manifest) {
  const entries = new Set();
  const addPath = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    entries.add(normalized);
  };

  Object.keys(manifest || {}).forEach(addPath);
  Object.values(manifest || {}).forEach(addPath);

  const ancillary = [
    '/runtime-env.js',
    '/service-worker.min.js',
    '/service-worker.js',
    '/dist/manifest.json',
  ];
  ancillary.forEach(addPath);

  return entries;
}

async function purgeBatch(files) {
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
    const errorDetail = Array.isArray(payload.errors) ? payload.errors : [payload.errors];
    throw new Error(`CDN purge failed: ${JSON.stringify(errorDetail)}`);
  }
}

function chunk(list, size) {
  const result = [];
  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size));
  }
  return result;
}

async function main() {
  const manifest = loadManifest(manifestPath);
  const pathSet = buildPurgePathSet(manifest);
  if (pathSet.size === 0) {
    console.warn('No CDN paths detected in manifest, skipping purge');
    return;
  }

  const urls = Array.from(pathSet)
    .map((pathname) => `${cdnBaseUrl}${pathname}`)
    .filter((url) => /^https?:\/\//.test(url));

  if (urls.length === 0) {
    console.warn('No valid CDN URLs generated, skipping purge');
    return;
  }

  const batches = chunk(urls, 30);
  for (const [index, batch] of batches.entries()) {
    await purgeBatch(batch);
    console.log(
      `Purged CDN batch ${index + 1}/${batches.length} (${batch.length} files)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
