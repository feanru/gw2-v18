import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.join(__dirname, '..');

  const htmlFiles = (await fs.readdir(rootDir)).filter((name) => name.endsWith('.html'));
  const runtimeRegex = /<script\b[^>]*\bsrc=["']\/runtime-env\.js["'][^>]*>\s*<\/script>/i;
  const moduleRegex = /<script\b[^>]*type\s*=\s*["']module["'][^>]*>/gi;
  const workerRegex = /<script\b[^>]*\bsrc=["'][^"']*(?:worker|sw-register)[^"']*["'][^>]*>/gi;

  for (const file of htmlFiles) {
    const filePath = path.join(rootDir, file);
    const content = await fs.readFile(filePath, 'utf8');
    const runtimeMatch = runtimeRegex.exec(content);
    assert.ok(runtimeMatch, `${file}: missing <script src="/runtime-env.js"></script>`);
    const runtimeIndex = runtimeMatch.index;

    moduleRegex.lastIndex = 0;
    for (const match of content.matchAll(moduleRegex)) {
      assert.ok(
        match.index > runtimeIndex,
        `${file}: <script type="module"> must appear after /runtime-env.js`,
      );
    }

    workerRegex.lastIndex = 0;
    for (const match of content.matchAll(workerRegex)) {
      assert.ok(
        match.index > runtimeIndex,
        `${file}: worker scripts must appear after /runtime-env.js`,
      );
    }
  }

  const manifestPath = path.join(rootDir, 'dist', 'manifest.json');
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  const requiredEntries = [
    '/dist/js/config.min.js',
    '/dist/js/sw-register.min.js',
    '/dist/js/bundle-auth-nav.min.js',
    '/dist/js/bundle-utils-1.min.js',
    '/dist/js/workers/ingredientTreeWorker.js',
    '/dist/js/workers/costsWorker.js',
    '/dist/js/workers/donesWorker.js',
    '/dist/js/workers/ventasComprasWorker.js',
  ];

  for (const entry of requiredEntries) {
    assert.ok(Object.prototype.hasOwnProperty.call(manifest, entry), `manifest.json missing entry for ${entry}`);
    const value = manifest[entry];
    assert.equal(typeof value, 'string', `manifest entry for ${entry} must be a string`);
    assert.ok(value.startsWith('/dist/'), `manifest entry for ${entry} must point to /dist/`);
  }

  console.log('runtime order and manifest checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
