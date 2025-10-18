import assert from 'assert';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');

const result = spawnSync('php', ['tests/php/cache_invalidation_multi.php'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

assert.strictEqual(result.status, 0, `cache invalidation script failed: ${result.stderr || result.stdout}`);
