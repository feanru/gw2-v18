import { promises as fs } from 'fs';
import path from 'path';

const distDir = path.resolve('dist');

async function findHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

function resolveRef(ref, baseDir) {
  if (/^(?:[a-zA-Z]+:)?\/\//.test(ref)) {
    return null; // Ignore external URLs
  }
  if (ref.startsWith('/')) {
    return path.join(distDir, ref.slice(1));
  }
  return path.resolve(baseDir, ref);
}

async function checkFile(htmlFile) {
  const content = await fs.readFile(htmlFile, 'utf8');
  const baseDir = path.dirname(htmlFile);
  const missing = [];

  const scriptSrcs = [...content.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  const imports = [...content.matchAll(/import\((['"])([^'"\)]+)\1\)/g)].map(m => m[2]);

  for (const ref of [...scriptSrcs, ...imports]) {
    const resolved = resolveRef(ref, baseDir);
    if (!resolved) continue; // external URL
    try {
      await fs.access(resolved);
    } catch {
      missing.push(`${ref} in ${path.relative(distDir, htmlFile)}`);
    }
  }
  return missing;
}

async function main() {
  try {
    await fs.access(distDir);
  } catch {
    console.error(`Directory not found: ${distDir}`);
    process.exit(1);
  }

  const htmlFiles = await findHtmlFiles(distDir);
  const missing = [];
  for (const file of htmlFiles) {
    const res = await checkFile(file);
    missing.push(...res);
  }

  if (missing.length > 0) {
    console.error('Missing assets detected:');
    for (const item of missing) {
      console.error(' -', item);
    }
    process.exit(1);
  } else {
    console.log('All referenced assets exist.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
