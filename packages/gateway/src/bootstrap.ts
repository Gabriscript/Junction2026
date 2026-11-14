/**
 * Wire the real dependencies: catalogue SQLite (read-only), gateway SQLite (orders + audit),
 * signing key from .env, Aimo client from .env.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { AimoClient } from './aimo/client.js';
import { AuditStore } from './audit/store.js';
import { openCatalogueDb, SqliteCatalogue } from './catalogue/store.js';
import { CATALOGUE_DB_PATH, ConfigError, DATA_DIR, GATEWAY_DB_PATH, gatewayConfig, type GatewayConfig } from './config.js';
import { OrderStore } from './orders/store.js';
import { GatewayService } from './service.js';
import { loadSigningKey, type SigningKey } from './trust/keys.js';

export interface Gateway {
  service: GatewayService;
  audit: AuditStore;
  key: SigningKey;
  config: GatewayConfig;
  close(): void;
}

export async function createGateway(overrides: Partial<GatewayConfig> = {}): Promise<Gateway> {
  const config = { ...gatewayConfig(), ...overrides };
  if (!existsSync(CATALOGUE_DB_PATH)) {
    throw new ConfigError(`Catalogue database not found at ${CATALOGUE_DB_PATH}. Run \`npm run load-catalogue\` first.`);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const catalogueDb = openCatalogueDb(CATALOGUE_DB_PATH, { readOnly: true });
  const gatewayDb = new DatabaseSync(GATEWAY_DB_PATH);
  gatewayDb.exec('PRAGMA journal_mode = WAL');
  const audit = new AuditStore(gatewayDb);
  const orders = new OrderStore(gatewayDb);
  const key = await loadSigningKey();
  const aimo = AimoClient.fromEnv();
  const service = new GatewayService({ catalogue: new SqliteCatalogue(catalogueDb), aimo, key, audit, orders, config });
  return {
    service,
    audit,
    key,
    config,
    close: () => {
      catalogueDb.close();
      gatewayDb.close();
    },
  };
}
