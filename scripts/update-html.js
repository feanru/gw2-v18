const fs = require('fs');
const path = require('path');

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
  const moduleMatch = moduleRegex.exec(sanitizedContent);

  if (!moduleMatch) {
    return sanitizedContent;
  }

  const moduleIndex = moduleMatch.index;
  const lineStart = sanitizedContent.lastIndexOf('\n', moduleIndex - 1) + 1;
  const indentMatch = sanitizedContent
    .slice(lineStart, moduleIndex)
    .match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const insertion = `${indent}${scriptTag}\n`;

  return (
    sanitizedContent.slice(0, lineStart) +
    insertion +
    sanitizedContent.slice(lineStart)
  );
}
