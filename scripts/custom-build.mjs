import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SRC_ROOT = path.resolve('src/js');
const DIST_ROOT = path.resolve('dist');

function ensureTrailingMin(relPath) {
  if (!relPath.endsWith('.js')) {
    return relPath;
  }
  if (relPath.endsWith('.min.js')) {
    return relPath;
  }
  if (relPath.startsWith('workers/')) {
    return relPath;
  }
  return relPath.replace(/\.js$/, '.min.js');
}

async function getNextVersion() {
  const entries = await fs.readdir(DIST_ROOT, { withFileTypes: true }).catch(async (err) => {
    if (err.code === 'ENOENT') {
      await fs.mkdir(DIST_ROOT, { recursive: true });
      return [];
    }
    throw err;
  });
  const versions = entries
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name.split('.').map(Number));
  if (versions.length === 0) {
    return '0.0.1';
  }
  versions.sort((a, b) => {
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) {
        return a[i] - b[i];
      }
    }
    return 0;
  });
  const latest = versions.pop();
  const [major, minor, patch] = latest;
  return `${major}.${minor}.${patch + 1}`;
}

function collectRelativeSpecifiers(content) {
  const patterns = [
    /import\s+[^'";]+?from\s+['"](\.?\.\/[^'";]+?\.js)['"]/g,
    /import\s*\(\s*['"](\.?\.\/[^'";]+?\.js)['"]\s*\)/g,
  ];
  const matches = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      matches.add(match[1]);
    }
  }
  return Array.from(matches);
}

function rewriteSpecifiers(content) {
  const replacers = [
    /(['"])(\.?\.\/[^'";]+?)(\.js)(['"])/g,
    /(import\(\s*['"])(\.?\.\/[^'";]+?)(\.js)(['"]\s*\))/g,
    /(new\s+URL\(\s*['"])(\.?\.\/[^'";]+?)(\.js)(['"],)/g,
  ];
  let updated = content;
  for (const pattern of replacers) {
    updated = updated.replace(pattern, (full, prefix, spec, ext, suffix) => {
      if (spec.endsWith('.min')) {
        return `${prefix}${spec}${ext}${suffix}`;
      }
      const normalized = `${spec}.min`;
      return `${prefix}${normalized}${ext}${suffix}`;
    });
  }
  return updated;
}

const processed = new Map();

async function processModule(srcPath, versionDir) {
  const absoluteSrc = await resolveSourceModule(path.resolve(srcPath));
  if (!absoluteSrc.startsWith(SRC_ROOT)) {
    return;
  }
  if (processed.has(absoluteSrc)) {
    return;
  }
  const relFromRoot = path.relative(SRC_ROOT, absoluteSrc);
  const destRelative = ensureTrailingMin(relFromRoot);
  const destPath = path.join(versionDir, destRelative);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const originalContent = await fs.readFile(absoluteSrc, 'utf8');
  const dependencies = collectRelativeSpecifiers(originalContent);
  const rewritten = rewriteSpecifiers(originalContent);
  await fs.writeFile(destPath, rewritten, 'utf8');
  processed.set(absoluteSrc, destRelative);
  for (const specifier of dependencies) {
    const normalizedSpecifier = specifier.endsWith('.js') ? specifier : `${specifier}.js`;
    const targetPath = await resolveSourceModule(
      path.resolve(path.dirname(absoluteSrc), normalizedSpecifier)
    );
    await processModule(targetPath, versionDir);
  }
}

async function resolveSourceModule(candidatePath) {
  try {
    await fs.access(candidatePath);
    return candidatePath;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
  if (candidatePath.endsWith('.min.js')) {
    const fallback = candidatePath.replace(/\.min\.js$/, '.js');
    await fs.access(fallback);
    return fallback;
  }
  throw new Error(`Unable to resolve source module: ${candidatePath}`);
}

function getEntryOriginalPath(entryName, entrySrcPath) {
  if (entrySrcPath.includes(`${path.sep}workers${path.sep}`)) {
    return `/dist/js/workers/${entryName}.js`;
  }
  return `/dist/js/${entryName}.min.js`;
}

async function main() {
  const version = process.env.NEXT_VERSION || (await getNextVersion());
  const versionDir = path.join(DIST_ROOT, version, 'js');
  await fs.mkdir(versionDir, { recursive: true });
  const config = (await import(path.resolve('rollup.config.js'))).default;
  const manifest = {};
  for (const [entryName, entryPath] of Object.entries(config.input)) {
    const entryAbsolute = path.resolve(entryPath);
    await processModule(entryAbsolute, versionDir);
    const destRelative = processed.get(entryAbsolute) || ensureTrailingMin(path.relative(SRC_ROOT, entryAbsolute));
    const outputRelative = destRelative;
    const originalPath = getEntryOriginalPath(entryName, entryAbsolute);
    manifest[originalPath] = `/dist/${version}/js/${outputRelative.replace(/\\/g, '/')}`;
  }
  const serviceShimPath = path.join(versionDir, 'services.min.js');
  await fs.writeFile(serviceShimPath, "import './services/recipeService.min.js';\n", 'utf8');
  manifest['/dist/js/services.min.js'] = `/dist/${version}/js/services.min.js`;
  manifest['/dist/js/services/recipeService.min.js'] = `/dist/${version}/js/services/recipeService.min.js`;
  await fs.writeFile(path.join(DIST_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Generated dist version ${version}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
