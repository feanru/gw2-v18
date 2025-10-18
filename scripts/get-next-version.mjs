import { existsSync, mkdirSync, readdirSync } from 'node:fs';

const distRoot = 'dist';
const versionPattern = /^\d+\.\d+\.\d+$/;

if (!existsSync(distRoot)) {
  mkdirSync(distRoot, { recursive: true });
  process.stdout.write('0.0.1');
  process.exit(0);
}

const versions = readdirSync(distRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && versionPattern.test(entry.name))
  .map((entry) => entry.name.split('.').map(Number));

if (versions.length === 0) {
  process.stdout.write('0.0.1');
  process.exit(0);
}

const [major, minor, patch] = versions
  .sort((a, b) => {
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) {
        return a[i] - b[i];
      }
    }
    return 0;
  })
  .pop();

process.stdout.write(`${major}.${minor}.${patch + 1}`);

