/**
 * SQLite catalogue (food only) with an FTS5 name index.
 *
 * Uses Node's built-in `node:sqlite` (no native build step). The loader writes it once;
 * the gateway opens it read-only. `search_products` never touches the Aimo API.
 */
import { DatabaseSync } from 'node:sqlite';
import { ProductSchema, type Product, type SearchProductsInput, type SearchProductsOutput } from '@junction/shared';

export interface Catalogue {
  search(input: SearchProductsInput): SearchProductsOutput;
  getById(id: string): Product | null;
  getMany(ids: readonly string[]): Map<string, Product>;
  count(): number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_fi TEXT,
  category TEXT NOT NULL,
  sales_unit TEXT NOT NULL,
  net_unit TEXT,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_attributes (
  product_id TEXT NOT NULL REFERENCES products(id),
  attr TEXT NOT NULL,
  PRIMARY KEY (product_id, attr)
);
CREATE TABLE IF NOT EXISTS product_allergens (
  product_id TEXT NOT NULL REFERENCES products(id),
  code TEXT NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY (product_id, code, level)
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_allergens_code ON product_allergens(code, level);
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  id UNINDEXED, name, name_fi, brand, supplier,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function openCatalogueDb(path: string, options: { readOnly?: boolean } = {}): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  if (!options.readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(SCHEMA);
  }
  return db;
}

/** Turn free text into an FTS5 query: every token must match as a prefix. Quotes neutralise FTS syntax. */
export function ftsQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' AND ');
}

export class SqliteCatalogue implements Catalogue {
  constructor(private readonly db: DatabaseSync) {}

  /** Replace the whole catalogue in one transaction. */
  replaceAll(products: Iterable<Product>, meta: Record<string, string> = {}): number {
    const db = this.db;
    const insProduct = db.prepare(
      'INSERT INTO products (id, name, name_fi, category, sales_unit, net_unit, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const insAttr = db.prepare('INSERT OR IGNORE INTO product_attributes (product_id, attr) VALUES (?, ?)');
    const insAllergen = db.prepare('INSERT OR IGNORE INTO product_allergens (product_id, code, level) VALUES (?, ?, ?)');
    const insFts = db.prepare('INSERT INTO products_fts (id, name, name_fi, brand, supplier) VALUES (?, ?, ?, ?, ?)');
    const insMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    let n = 0;
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM product_allergens; DELETE FROM product_attributes; DELETE FROM products_fts; DELETE FROM products;');
      for (const p of products) {
        insProduct.run(p.id, p.name, p.nameFi ?? null, p.category, p.pack.salesUnit, p.pack.netContent?.unit ?? null, JSON.stringify(p));
        for (const a of p.attributes) insAttr.run(p.id, a);
        for (const al of p.allergens) insAllergen.run(p.id, al.code, al.level);
        insFts.run(p.id, p.name, p.nameFi ?? '', p.brand ?? '', p.supplier);
        n++;
      }
      for (const [k, v] of Object.entries({ ...meta, productCount: String(n), loadedAt: new Date().toISOString() })) insMeta.run(k, v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
    return row.n;
  }

  meta(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  getById(id: string): Product | null {
    const row = this.db.prepare('SELECT json FROM products WHERE id = ?').get(id) as { json: string } | undefined;
    return row ? ProductSchema.parse(JSON.parse(row.json)) : null;
  }

  getMany(ids: readonly string[]): Map<string, Product> {
    const out = new Map<string, Product>();
    const stmt = this.db.prepare('SELECT json FROM products WHERE id = ?');
    for (const id of new Set(ids)) {
      const row = stmt.get(id) as { json: string } | undefined;
      if (row) out.set(id, ProductSchema.parse(JSON.parse(row.json)));
    }
    return out;
  }

  search(input: SearchProductsInput): SearchProductsOutput {
    const limit = input.limit ?? 20;
    const attributes = input.attributes ?? [];
    const freeFrom = input.freeFromAllergens ?? [];
    const params: (string | number)[] = [];
    const where: string[] = [];
    let from = 'products p';
    let order = 'p.name';

    const q = input.text ? ftsQuery(input.text) : null;
    if (q) {
      from = 'products_fts f JOIN products p ON p.id = f.id';
      where.push('products_fts MATCH ?');
      params.push(q);
      order = 'bm25(products_fts), p.name';
    }
    if (input.category) {
      where.push('p.category = ?');
      params.push(input.category);
    }
    if (input.unit) {
      where.push('p.net_unit = ?');
      params.push(input.unit);
    }
    for (const attr of attributes) {
      where.push('EXISTS (SELECT 1 FROM product_attributes a WHERE a.product_id = p.id AND a.attr = ?)');
      params.push(attr);
    }
    for (const code of freeFrom) {
      // Safe = explicit FREE_FROM, or allergen data present with no CONTAINS/MAY_CONTAIN for the code.
      // Products without any allergen data are unknown → excluded.
      where.push(
        `(EXISTS (SELECT 1 FROM product_allergens x WHERE x.product_id = p.id AND x.code = ? AND x.level = 'FREE_FROM')
          OR (EXISTS (SELECT 1 FROM product_allergens y WHERE y.product_id = p.id)
              AND NOT EXISTS (SELECT 1 FROM product_allergens z WHERE z.product_id = p.id AND z.code = ? AND z.level IN ('CONTAINS','MAY_CONTAIN'))))`,
      );
      params.push(code, code);
    }
    const sql = `SELECT p.json FROM ${from}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`;
    params.push(limit + 1);
    const rows = this.db.prepare(sql).all(...params) as { json: string }[];
    const products = rows.slice(0, limit).map((r) => ProductSchema.parse(JSON.parse(r.json)));
    return { products, truncated: rows.length > limit };
  }
}

/** In-memory catalogue from already-projected products (tests, mock mode). */
export function memoryCatalogue(products: readonly Product[]): SqliteCatalogue {
  const db = openCatalogueDb(':memory:');
  const cat = new SqliteCatalogue(db);
  cat.replaceAll(products, { source: 'memory' });
  return cat;
}
