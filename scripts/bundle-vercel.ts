#!/usr/bin/env tsx
/**
 * Vercel bundle: one self-contained CommonJS file per backend service, `deploy/<service>/dist/server.cjs`,
 * loaded by the committed `deploy/<service>/index.cjs`. The function then needs no node_modules, no workspace
 * links and no "type": "module", whatever Vercel's entrypoint detection or ESM handling does.
 * The gateway bundle also embeds the catalogue and the swagger-ui assets, written to the tmp dir at cold start.
 *
 *   tsx scripts/bundle-vercel.ts gateway|assistant
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build, type BuildOptions, type Plugin } from 'esbuild';
import { CATALOGUE_DB_PATH } from '../packages/gateway/src/config.js';

const ROOT = resolve(import.meta.dirname, '..');
const service = process.argv[2];

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: resolve(ROOT, 'deploy', service ?? '', 'dist', 'server.cjs'),
  // the sources use import.meta.url (.env and data paths); CJS has no import.meta
  define: { 'import.meta.url': '__import_meta_url' },
  banner: { js: "const __import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
  legalComments: 'none',
  logLevel: 'info',
};

// tmp dir of the function (Vercel: /tmp); swagger-ui reads its static files relative to its own __dirname
const TMP = "require('node:path').join(require('node:os').tmpdir(), 'aimo-gateway')";

function gatewayAssets(): Plugin {
  const swaggerDir = dirname(createRequire(resolve(ROOT, 'packages/gateway/package.json')).resolve('@fastify/swagger-ui'));
  const files: Record<string, string> = { 'catalogue.sqlite': readFileSync(CATALOGUE_DB_PATH).toString('base64') };
  for (const f of readdirSync(join(swaggerDir, 'static'))) {
    files[`swagger-ui/static/${f}`] = readFileSync(join(swaggerDir, 'static', f)).toString('base64');
  }
  return {
    name: 'gateway-assets',
    setup(b) {
      b.onResolve({ filter: /^vercel-assets$/ }, () => ({ path: 'vercel-assets', namespace: 'vercel-assets' }));
      b.onLoad({ filter: /.*/, namespace: 'vercel-assets' }, () => ({ contents: JSON.stringify(files), loader: 'json' }));
      b.onLoad({ filter: /[\\/]@fastify[\\/]swagger-ui[\\/](index|lib[\\/]routes)\.js$/ }, (a) => ({
        contents: readFileSync(a.path, 'utf8').replaceAll(
          '__dirname',
          /index\.js$/.test(a.path) ? `require('node:path').join(${TMP}, 'swagger-ui')` : `require('node:path').join(${TMP}, 'swagger-ui', 'lib')`,
        ),
        loader: 'js',
      }));
    },
  };
}

const GATEWAY_ENTRY = `
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const tmp = ${TMP};
for (const [rel, b64] of Object.entries(require('vercel-assets'))) {
  const p = join(tmp, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, Buffer.from(b64, 'base64'));
}
process.env.CATALOGUE_DB_PATH = join(tmp, 'catalogue.sqlite');
require('./packages/gateway/src/server.ts');
`;

if (service === 'gateway') {
  await build({ ...common, stdin: { contents: GATEWAY_ENTRY, resolveDir: ROOT, loader: 'js' }, plugins: [gatewayAssets()] });
} else if (service === 'assistant') {
  await build({ ...common, entryPoints: [resolve(ROOT, 'packages/agent/src/assistant/server.ts')] });
} else {
  console.error('usage: tsx scripts/bundle-vercel.ts gateway|assistant');
  process.exit(1);
}
