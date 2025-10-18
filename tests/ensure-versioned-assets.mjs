import { promises as fs } from 'fs';
import path from 'path';

const repoRoot = path.resolve('.');
const manifestPath = path.join(repoRoot, 'dist', 'manifest.json');
const ignoredDirectories = new Set([
  '.git',
  '.github',
  'backend',
  'css',
  'dist',
  'docs',
  'img',
  'migrations',
  'node_modules',
  'packages',
  'scripts',
  'tests',
  'ui'
]);

async function findHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      files.push(...await findHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function loadManifest() {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`No se pudo cargar el manifest en ${manifestPath}: ${err.message}`);
  }
}

const assetPattern = /\/dist\/(?:js|\d+\.\d+\.\d+)\/js\/[^\s"'()<>]+/g;

function validateReference(ref, manifest, relativeFile) {
  const errors = [];

  if (ref.startsWith('/dist/js/')) {
    const target = manifest[ref];
    if (!target) {
      errors.push(`No existe una entrada en el manifest para ${ref} (referenciado en ${relativeFile}).`);
    } else {
      errors.push(`La referencia ${ref} en ${relativeFile} debe apuntar a ${target}.`);
    }
  } else {
    const [, versionedPart] = ref.match(/^\/dist\/(\d+\.\d+\.\d+)\/js\//) || [];
    if (!versionedPart) {
      errors.push(`No se pudo interpretar la ruta ${ref} en ${relativeFile}.`);
      return errors;
    }
    const filename = ref.slice(`/dist/${versionedPart}/js/`.length);
    const canonical = `/dist/js/${filename}`;
    const target = manifest[canonical];
    if (!target) {
      errors.push(`No existe una entrada en el manifest para ${canonical}, requerido por ${ref} en ${relativeFile}.`);
    } else if (target !== ref) {
      errors.push(`El manifest asigna ${canonical} -> ${target}, pero ${relativeFile} usa ${ref}.`);
    }
  }

  return errors;
}

async function checkFile(filePath, manifest) {
  const content = await fs.readFile(filePath, 'utf8');
  const relative = path.relative(repoRoot, filePath);
  const matches = content.match(assetPattern) || [];
  const errors = [];

  for (const ref of matches) {
    errors.push(...validateReference(ref, manifest, relative));
  }

  return { file: relative, errors };
}

async function main() {
  const manifest = await loadManifest();
  const htmlFiles = await findHtmlFiles(repoRoot);

  const problems = [];
  for (const file of htmlFiles) {
    const result = await checkFile(file, manifest);
    problems.push(...result.errors);
  }

  if (problems.length > 0) {
    console.error('Se detectaron referencias sin versión:');
    for (const issue of problems) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  console.log('Todas las referencias a /dist/js/ usan rutas versionadas del manifest.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
