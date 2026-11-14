/**
 * Gateway configuration, read once from the environment.
 *
 * `.env` at the repo root is loaded with Node's built-in `process.loadEnvFile` (no dotenv).
 * Nothing here is ever logged: the API key and signing key stay in memory only.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (two levels above `packages/gateway/src`, or above `dist`). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ENV_FILE = resolve(REPO_ROOT, '.env');
export const DATA_DIR = resolve(REPO_ROOT, 'data');
export const RAW_DATA_DIR = resolve(DATA_DIR, 'raw');
export const CATALOGUE_DB_PATH = resolve(DATA_DIR, 'catalogue.sqlite');
export const GATEWAY_DB_PATH = resolve(DATA_DIR, 'gateway.sqlite');

let envLoaded = false;
/** Load `.env` into `process.env` once (existing variables win). Silent when the file is missing. */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  if (existsSync(ENV_FILE)) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      /* unreadable .env: fall through, requireEnv() reports what is missing */
    }
  }
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function requireEnv(name: string, hint: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new ConfigError(`Missing ${name}. ${hint} (set it in ${ENV_FILE}, which is git-ignored).`);
  }
  return v.trim();
}

export function optionalEnv(name: string): string | undefined {
  loadEnv();
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export interface AimoApiConfig {
  baseUrl: string;
  apiKey: string;
}

/** Aimo mock API credentials. Fails fast with a clear message when the key is missing. */
export function aimoApiConfig(): AimoApiConfig {
  return {
    baseUrl: (optionalEnv('AIMO_API_BASE_URL') ?? 'https://junction26.valioaimo.fi').replace(/\/+$/, ''),
    apiKey: requireEnv('AIMO_API_KEY', 'The Valio Aimo API key is distributed on the Junction platform'),
  };
}

/** Static list of agents Valio Aimo knows (PLAN-review §1: no registry in v0.1). */
export interface KnownAgent {
  agentId: string;
  /** Aimo customer numbers this agent may buy for. */
  customerRefs: string[];
  name: string;
  /** Max shortlist items (price+availability lookups) per rolling hour. */
  queryBudgetPerHour: number;
}

export const DEFAULT_KNOWN_AGENTS: readonly KnownAgent[] = [
  { agentId: 'agent:hotel-buyer-1', customerRefs: ['123'], name: 'Hotel Aurora buyer agent', queryBudgetPerHour: 500 },
  { agentId: 'agent:hospital-buyer-1', customerRefs: ['456'], name: 'Hospital buyer agent', queryBudgetPerHour: 500 },
  { agentId: 'agent:demo-1', customerRefs: ['123', '456', '789'], name: 'Demo agent (Claude Desktop)', queryBudgetPerHour: 500 },
];

export interface GatewayConfig {
  port: number;
  host: string;
  /** Public base URL used in `issuer` / `jwksUrl`, e.g. http://localhost:8787 */
  publicUrl: string;
  /** Offer validity window in minutes. */
  offerTtlMinutes: number;
  knownAgents: readonly KnownAgent[];
  policyVersion: string;
}

export function gatewayConfig(): GatewayConfig {
  loadEnv();
  const port = Number(optionalEnv('GATEWAY_PORT') ?? 8787);
  const host = optionalEnv('GATEWAY_HOST') ?? '127.0.0.1';
  return {
    port,
    host,
    publicUrl: (optionalEnv('GATEWAY_PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    offerTtlMinutes: Number(optionalEnv('OFFER_TTL_MINUTES') ?? 30),
    knownAgents: DEFAULT_KNOWN_AGENTS,
    policyVersion: 'policy-0.1',
  };
}
