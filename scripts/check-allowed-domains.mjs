#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const repoRoot = resolve(__dirname, '..');

const TARGET_FILES = [
  'runtime-env.js',
  'src/js/config.js',
  'src/js/workers/ingredientTreeWorker.js',
];

const ALLOWED_URLS = new Set([
  'https://www.google-analytics.com',
  'https://region1.google-analytics.com',
  'https://www.googletagmanager.com',
  'https://api.guildwars2.com',
  'https://api.datawars2.ie',
  'https://api.datawars2.ie/gw2/v1/items/csv',
]);

const ALLOWED_HOSTS = new Set([
  'www.google-analytics.com',
  'region1.google-analytics.com',
  'www.googletagmanager.com',
  'api.guildwars2.com',
  'api.datawars2.ie',
]);

const ALLOWED_PREFIXES = [
  'https://api.datawars2.ie/gw2/v1/items/csv',
];

const urlPattern = /https?:\/\/[^\s"'`<>]+/g;

const violations = [];

for (const relativePath of TARGET_FILES) {
  const absolutePath = resolve(repoRoot, relativePath);
  let content;
  try {
    content = await readFile(absolutePath, 'utf8');
  } catch (error) {
    violations.push({
      file: relative(repoRoot, absolutePath),
      url: '<unable to read file>',
      reason: error.message,
    });
    continue;
  }

  const matches = content.matchAll(urlPattern);
  for (const match of matches) {
    const [rawUrl] = match;
    if (!isAllowed(rawUrl)) {
      violations.push({
        file: relative(repoRoot, absolutePath),
        url: rawUrl,
      });
    }
  }
}

if (violations.length > 0) {
  const header = 'Se encontraron dominios externos no autorizados:';
  console.error(header);
  for (const violation of violations) {
    if (violation.reason) {
      console.error(` - ${violation.file}: ${violation.reason}`);
    } else {
      console.error(` - ${violation.file}: ${violation.url}`);
    }
  }
  process.exitCode = 1;
} else {
  if (process.env.CI) {
    console.log('No unauthorized runtime domains detected.');
  }
}

function isAllowed(urlText) {
  if (ALLOWED_URLS.has(urlText)) {
    return true;
  }
  if (ALLOWED_PREFIXES.some((prefix) => urlText.startsWith(prefix))) {
    return true;
  }
  try {
    const parsed = new URL(urlText);
    if (ALLOWED_URLS.has(parsed.origin) || ALLOWED_URLS.has(parsed.href)) {
      return true;
    }
    if (ALLOWED_HOSTS.has(parsed.hostname)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
