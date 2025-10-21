const fs = require('fs');
const path = require('path');
const vm = require('vm');

const manifestPath = path.join(__dirname, '..', 'dist', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Manifest file not found:', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const nextVersion = getNextVersionFromManifest(manifest);

if (!nextVersion) {
  console.error('Unable to determine version from manifest:', manifestPath);
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const runtimeEnvPath = path.join(rootDir, 'runtime-env.js');
validateRuntimeEnv(runtimeEnvPath);

const htmlFiles = fs.readdirSync(rootDir).filter((f) => f.endsWith('.html'));

for (const file of htmlFiles) {
  const filePath = path.join(rootDir, file);
  updateHtmlFile(filePath, manifest, nextVersion);
}

function getNextVersionFromManifest(currentManifest) {
  const versionPattern = /^\/dist\/(\d+\.\d+\.\d+)\/js\//;
  for (const value of Object.values(currentManifest)) {
    const match = value.match(versionPattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAssetRegex(originalPath) {
  const SEMVER_PATTERN = '(\\d+\\.\\d+\\.\\d+)';
  const relativePath = originalPath.replace(/^\/dist\/js\//, '');
  const escapedPath = escapeRegExp(relativePath);
  const pattern = `\/dist\/(?:${SEMVER_PATTERN}\/)?js\/${escapedPath}`;
  return new RegExp(pattern, 'g');
}

function getReplacementPath(originalPath, version) {
  const relativePath = originalPath.replace(/^\/dist\/js\//, '');
  return `/dist/${version}/js/${relativePath}`;
}

function updateHtmlFile(filePath, currentManifest, version) {
  const originalContent = fs.readFileSync(filePath, 'utf8');
  let updatedContent = originalContent;

  for (const originalPath of Object.keys(currentManifest)) {
    if (!originalPath.startsWith('/dist/js/')) {
      continue;
    }

    const regex = buildAssetRegex(originalPath);
    const replacement = getReplacementPath(originalPath, version);

    updatedContent = updatedContent.replace(regex, (_match, _existingVersion) => replacement);
  }

  updatedContent = ensureRuntimeScript(updatedContent);

  if (updatedContent !== originalContent) {
    fs.writeFileSync(filePath, updatedContent);
  }
}

function ensureRuntimeScript(content) {
  const scriptTag = '<script src="/runtime-env.js"></script>';
  const scriptLineRegex = /^[ \t]*<script src="\/runtime-env\.js"><\/script>[^\S\r\n]*(?:\r?\n)?/gm;

  let sanitizedContent = content.replace(scriptLineRegex, '');

  const moduleRegex = /<script\s+type="module"/i;
  const workerRegex = /<script\b[^>]*\bsrc=["'][^"']*(?:worker|sw-register)[^"']*["'][^>]*>/i;
  const moduleMatch = moduleRegex.exec(sanitizedContent);
  const workerMatch = workerRegex.exec(sanitizedContent);

  const anchorMatch = [moduleMatch, workerMatch]
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)[0];

  if (!anchorMatch) {
    return sanitizedContent;
  }

  const anchorIndex = anchorMatch.index;
  const lineStart = sanitizedContent.lastIndexOf('\n', anchorIndex - 1) + 1;
  const indentMatch = sanitizedContent
    .slice(lineStart, anchorIndex)
    .match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const insertion = `${indent}${scriptTag}\n`;

  return (
    sanitizedContent.slice(0, lineStart) +
    insertion +
    sanitizedContent.slice(lineStart)
  );
}

function validateRuntimeEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('runtime-env.js not found:', filePath);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    window: {
      __RUNTIME_CONFIG__: {},
      __SECURE_RUNTIME_CONFIG__: {},
      location: { origin: 'https://example.invalid' },
      document: { documentElement: { lang: 'es' } },
      navigator: { language: 'es-ES' },
    },
  };

  try {
    vm.runInNewContext(source, sandbox, {
      filename: 'runtime-env.js',
      timeout: 1000,
    });
  } catch (error) {
    console.error('Failed to evaluate runtime-env.js:', error);
    process.exit(1);
  }

  const runtimeConfig = sandbox.window && sandbox.window.__RUNTIME_CONFIG__;
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    console.error('runtime-env.js did not populate window.__RUNTIME_CONFIG__.');
    process.exit(1);
  }

  const requiredKeys = ['API_BASE_URL', 'LANG', 'FLAGS'];
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(runtimeConfig, key)) {
      console.error(`runtime-env.js is missing required key "${key}" in window.__RUNTIME_CONFIG__.`);
      process.exit(1);
    }
  }

  if (typeof runtimeConfig.API_BASE_URL !== 'string' || !runtimeConfig.API_BASE_URL.trim()) {
    console.error('runtime-env.js must define a non-empty string API_BASE_URL.');
    process.exit(1);
  }

  if (typeof runtimeConfig.LANG !== 'string' || !runtimeConfig.LANG.trim()) {
    console.error('runtime-env.js must define LANG as a non-empty string.');
    process.exit(1);
  }

  if (!runtimeConfig.FLAGS || typeof runtimeConfig.FLAGS !== 'object' || Array.isArray(runtimeConfig.FLAGS)) {
    console.error('runtime-env.js must define FLAGS as an object.');
    process.exit(1);
  }
}
