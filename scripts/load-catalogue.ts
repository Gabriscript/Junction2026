#!/usr/bin/env tsx
/**
 * Catalogue loader (PLAN-review §4 Step 2).
 *
 *   npm run load-catalogue
 *
 * 1. Downloads the portal product JSON + reliability CSV + carbon CSV into `data/raw/`
 *    (git-ignored) with `curl -L -H "X-API-Key: ..."` — only when a file is missing.
 *    Files do not change during the challenge, so this runs once.
 * 2. Projects FOOD products only into `data/catalogue.sqlite` (FTS5 index, allergens,
 *    attributes), joining reliability + carbon (missing = null, never invented).
 *
 * The data files are untrusted input: parsed as data, never executed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { aimoApiConfig, CATALOGUE_DB_PATH, RAW_DATA_DIR } from '../packages/gateway/src/config.js';
import { isFood, parseProductCsv, projectProduct, type RawProduct } from '../packages/gateway/src/catalogue/project.js';
import { openCatalogueDb, SqliteCatalogue } from '../packages/gateway/src/catalogue/store.js';

const FILES = [
  { name: 'products.json', endpoint: '/api/products/download' },
  { name: 'delivery-reliability.csv', endpoint: '/api/delivery-reliability/download' },
  { name: 'carbon-footprint.csv', endpoint: '/api/carbon-footprint/download' },
] as const;

function download(name: string, endpoint: string): void {
  const target = resolve(RAW_DATA_DIR, name);
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`  ${name}: present (${(statSync(target).size / 1e6).toFixed(1)} MB), skipping download`);
    return;
  }
  const { baseUrl, apiKey } = aimoApiConfig();
  console.log(`  ${name}: downloading from ${baseUrl}${endpoint} …`);
  const part = `${target}.part`;
  // Key passed as an argv header; never echoed. curl follows the 307 redirect to the file.
  const res = spawnSync('curl', ['-sS', '-L', '-f', '-H', `X-API-Key: ${apiKey}`, '-o', part, `${baseUrl}${endpoint}`], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (res.status !== 0) {
    rmSync(part, { force: true });
    throw new Error(`curl failed for ${endpoint} (exit ${res.status}). Check AIMO_API_KEY and network.`);
  }
  renameSync(part, target);
  console.log(`  ${name}: ${(statSync(target).size / 1e6).toFixed(1)} MB`);
}

function main(): void {
  const t0 = Date.now();
  mkdirSync(RAW_DATA_DIR, { recursive: true });
  console.log('1/3 raw files');
  for (const f of FILES) download(f.name, f.endpoint);

  console.log('2/3 parsing');
  const rawText = readFileSync(resolve(RAW_DATA_DIR, 'products.json'), 'utf8');
  const parsed: unknown = JSON.parse(rawText);
  if (!Array.isArray(parsed)) throw new Error('products.json is not a JSON array');
  const raw = parsed as RawProduct[];
  const reliability = parseProductCsv(readFileSync(resolve(RAW_DATA_DIR, 'delivery-reliability.csv'), 'utf8'), 0, 1);
  const carbon = parseProductCsv(readFileSync(resolve(RAW_DATA_DIR, 'carbon-footprint.csv'), 'utf8'), 0);
  console.log(`  ${raw.length} products, ${reliability.size} reliability rows, ${carbon.size} carbon rows`);

  let food = 0;
  let dropped = 0;
  const products = [];
  for (const r of raw) {
    if (r?.deleted === true || !isFood(r)) continue;
    food++;
    const id = typeof r.id === 'string' ? r.id : '';
    const p = projectProduct(r, {
      deliveryReliability: reliability.get(id) ?? null,
      carbonKgCo2ePerKg: carbon.get(id) ?? null,
    });
    if (p) products.push(p);
    else dropped++;
  }
  console.log(`  ${food} food products (${raw.length - food} non-food skipped), ${dropped} unusable records dropped`);

  console.log('3/3 writing SQLite');
  rmSync(CATALOGUE_DB_PATH, { force: true });
  rmSync(`${CATALOGUE_DB_PATH}-wal`, { force: true });
  rmSync(`${CATALOGUE_DB_PATH}-shm`, { force: true });
  const db = openCatalogueDb(CATALOGUE_DB_PATH);
  const cat = new SqliteCatalogue(db);
  const n = cat.replaceAll(products, { source: 'portal', rawProducts: String(raw.length) });
  const withRel = products.filter((p) => p.deliveryReliability !== null).length;
  const withCo2 = products.filter((p) => p.carbonKgCo2ePerKg !== null).length;
  console.log(`  ${n} products written to ${CATALOGUE_DB_PATH} (reliability on ${withRel}, carbon on ${withCo2})`);

  const sample = cat.search({ text: 'lactose free milk', limit: 5 });
  console.log(`  smoke: "lactose free milk" → ${sample.products.length} hits, e.g. ${sample.products.map((p) => `${p.id} ${p.name}`).slice(0, 3).join(' | ')}`);
  db.close();
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main();
