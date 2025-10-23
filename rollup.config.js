import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import { readdirSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function getNextVersion() {
  const distRoot = 'dist';
  const versionPattern = /^\d+\.\d+\.\d+$/;

  const envVersion = process.env.NEXT_VERSION;

  if (envVersion) {
    if (!existsSync(distRoot)) {
      mkdirSync(distRoot, { recursive: true });
    }
    return envVersion;
  }

  if (!existsSync(distRoot)) {
    mkdirSync(distRoot, { recursive: true });
    return '0.0.1';
  }

  const versions = readdirSync(distRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && versionPattern.test(entry.name))
    .map((entry) => entry.name);

  if (versions.length === 0) {
    return '0.0.1';
  }

  const latest = versions
    .map((version) => version.split('.').map(Number))
    .sort((a, b) => {
      for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) {
          return a[i] - b[i];
        }
      }
      return 0;
    })
    .pop();

  const [major, minor, patch] = latest;

  return `${major}.${minor}.${patch + 1}`;
}

const nextVersion = getNextVersion();
const versionDir = join('dist', nextVersion, 'js');
const standaloneChunks = new Set(['src/js/utils/recipeUtils.js']);
const configChunkName = 'config';
const stableManualChunkNames = new Set(['services', 'utils', 'web-vitals', configChunkName]);
const fallbackRecipeServicePath = join('src', 'js', 'services', 'recipeService.min.js');
const recipeServiceStandaloneInput = join('src', 'js', 'services', 'recipeService.standalone.js');
const recipeServiceStandaloneFileName = 'recipeService.standalone.min.js';

const isWorkerChunk = (facadeModuleId) => {
  if (!facadeModuleId) {
    return false;
  }
  return facadeModuleId.replace(/\\+/g, '/').includes('/workers/');
};

if (!existsSync(versionDir)) {
  mkdirSync(versionDir, { recursive: true });
}

const mainConfig = {
  // Entradas separadas para cada vista o funcionalidad pesada
  input: {
    'bundle-auth-nav': 'src/js/bundle-auth-nav.js',
    'bundle-dones': 'src/js/bundle-dones.js',
    'bundle-fractales': 'src/js/bundle-fractales.js',
    'bundle-forja-mistica': 'src/js/bundle-forja-mistica.js',
    'bundle-legendary': 'src/js/bundle-legendary.js',
    'bundle-bags': 'src/js/bundle-bags.js',
    'bundle-utils-1': 'src/js/bundle-utils-1.js',
    'dones': 'src/js/dones.js',
    'compare-ui': 'src/js/compare-ui.js',
    'compareHandlers': 'src/js/compareHandlers.js',
    'cuenta': 'src/js/cuenta.js',
    'item-loader': 'src/js/item-loader.js',
    'item-mejores': 'src/js/item-mejores.js',
    'items-core': 'src/js/items-core.js',
    'itemHandlers': 'src/js/itemHandlers.js',
    'item-ui': 'src/js/item-ui.js',
    'tabs': 'src/js/tabs.js',
    'feedback-modal': 'src/js/feedback-modal.js',
    'leg-craft-tabs': 'src/js/leg-craft-tabs.js',
    'search-modal': 'src/js/search-modal.js',
    'search-modal-core': 'src/js/search-modal-core.js',
    'search-modal-compare-craft': 'src/js/search-modal-compare-craft.js',
    'sw-register': 'src/js/sw-register.js',
    'storageUtils': 'src/js/storageUtils.js',
    'ingredientTreeWorker': 'src/js/workers/ingredientTreeWorker.js',
    'costsWorker': 'src/js/workers/costsWorker.js',
    'donesWorker': 'src/js/workers/donesWorker.js',
    'ventasComprasWorker': 'src/js/workers/ventasComprasWorker.js',
    'ui-helpers': 'src/js/ui-helpers.js',
    'utils/recipeUtils': 'src/js/utils/recipeUtils.js'
  },
  external: ['./tabs.min.js', './services/recipeService.min.js'],
  plugins: [
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    {
      name: 'copy-recipe-service-fallback',
      generateBundle() {
        const servicesDir = join(versionDir, 'services');
        if (!existsSync(servicesDir)) {
          mkdirSync(servicesDir, { recursive: true });
        }
        const fallbackSource = readFileSync(fallbackRecipeServicePath, 'utf8');
        writeFileSync(join(servicesDir, 'recipeService.min.js'), fallbackSource);
      }
    },
    terser(),
    {
      name: 'manifest',
      generateBundle(options, bundle) {
        const manifest = {};
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk.type !== 'chunk') {
            continue;
          }

          const isWorker = isWorkerChunk(chunk.facadeModuleId);
          const isStableManualChunk =
            !chunk.isEntry &&
            (stableManualChunkNames.has(chunk.name) ||
              (chunk.facadeModuleId && chunk.facadeModuleId.includes('recipeService')));

          if (chunk.isEntry || isStableManualChunk) {
            const originalName = `/dist/js/${isWorker ? 'workers/' : ''}${chunk.name}${
              isWorker ? '.js' : '.min.js'
            }`;
            manifest[originalName] = `/dist/${nextVersion}/js/${fileName}`;
          }
        }
        manifest['/dist/js/services/recipeService.min.js'] = `/dist/${nextVersion}/js/services/recipeService.min.js`;
        manifest['/dist/js/recipeService.standalone.min.js'] = `/dist/${nextVersion}/js/${recipeServiceStandaloneFileName}`;
        writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
      }
    }
  ],
  output: {
    dir: versionDir,
    format: 'es',
    entryFileNames: (chunkInfo) => {
      const isWorker = isWorkerChunk(chunkInfo.facadeModuleId);
      return isWorker ? 'workers/[name].js' : '[name].min.js';
    },
    chunkFileNames: '[name].min.js',
    manualChunks(id) {
      for (const standalone of standaloneChunks) {
        if (id.includes(standalone)) {
          return;
        }
      }

      if (id.includes('src/js/utils/config.js')) {
        return configChunkName;
      }

      if (id.includes('src/js/config.js')) {
        return configChunkName;
      }

      if (id.includes('node_modules/web-vitals')) {
        return 'web-vitals';
      }

      if (id.includes('src/js/utils')) {
        return 'utils';
      }
      if (id.includes('src/js/services/recipeService.js')) {
        return 'services';
      }
    }
  }
};

const standaloneConfig = {
  input: recipeServiceStandaloneInput,
  plugins: [nodeResolve({ browser: true, preferBuiltins: false }), commonjs(), terser()],
  output: {
    file: join(versionDir, recipeServiceStandaloneFileName),
    format: 'iife',
    name: 'RecipeServiceBundle'
  }
};

export default [mainConfig, standaloneConfig];
