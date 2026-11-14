/**
 * Order persistence (SQLite, same database file as the audit chain).
 */
import type { DatabaseSync } from 'node:sqlite';
import { OrderSchema, type Order } from '@junction/shared';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  gross REAL NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_mandate ON orders(mandate_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_ref);
`;

export class OrderStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
  }

  save(order: Order): Order {
    const o = OrderSchema.parse(order);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO orders (order_id, mandate_id, customer_ref, agent_id, status, gross, created_at, json) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(o.orderId, o.mandateId, o.customerRef, o.agentId, o.status, o.totals.gross, o.createdAt, JSON.stringify(o));
    return o;
  }

  get(orderId: string): Order | null {
    const row = this.db.prepare('SELECT json FROM orders WHERE order_id = ?').get(orderId) as { json: string } | undefined;
    return row ? OrderSchema.parse(JSON.parse(row.json)) : null;
  }

  list(filter: { customerRef?: string; status?: Order['status'] } = {}, limit = 200): Order[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.customerRef) {
      where.push('customer_ref = ?');
      params.push(filter.customerRef);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    const sql = `SELECT json FROM orders${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as unknown as { json: string }[];
    return rows.map((r) => OrderSchema.parse(JSON.parse(r.json)));
  }

  /** Gross EUR committed under a mandate: auto-approved + human-approved orders. */
  spentGross(mandateId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(gross), 0) AS s FROM orders WHERE mandate_id = ? AND status IN ('auto_approved','approved')")
      .get(mandateId) as { s: number };
    return Math.round(row.s * 100) / 100;
  }
}
