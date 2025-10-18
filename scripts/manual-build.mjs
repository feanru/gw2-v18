import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const distRoot = path.resolve('dist');
const versionPattern = /^\d+\.\d+\.\d+$/;

function getSortedVersions() {
  if (!existsSync(distRoot)) {
    mkdirSync(distRoot, { recursive: true });
    return [];
  }
  return readdirSync(distRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && versionPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if (pa[i] !== pb[i]) {
          return pa[i] - pb[i];
        }
      }
      return 0;
    });
}

function incrementVersion(version) {
  if (!version) {
    return '0.0.1';
  }
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

async function copyDirectory(srcDir, destDir) {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await mkdir(path.dirname(destPath), { recursive: true });
      await cp(srcPath, destPath);
    }
  }
}

function runRollup(nextVersion) {
  return new Promise((resolve, reject) => {
    const rollupBin = path.resolve('node_modules/.bin/rollup');
    const child = spawn(rollupBin, ['-c'], {
      env: {
        ...process.env,
        NEXT_VERSION: nextVersion
      },
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`rollup exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

async function main() {
  const versions = getSortedVersions();
  const latest = versions.length > 0 ? versions[versions.length - 1] : null;
  const nextVersion = incrementVersion(latest);
  const versionDir = path.join(distRoot, nextVersion);
  const versionJsDir = path.join(versionDir, 'js');

  await rm(versionDir, { recursive: true, force: true });

  if (latest) {
    const latestDir = path.join(distRoot, latest);
    await copyDirectory(latestDir, versionDir);
  }

  await rm(versionJsDir, { recursive: true, force: true });

  await runRollup(nextVersion);

  await writeFile(path.resolve('version.txt'), `${Math.floor(Date.now() / 1000)}\n`, 'utf8');

  console.log(`Build artifacts generated in dist/${nextVersion}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
