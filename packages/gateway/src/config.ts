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
/** True inside a Vercel build or function (Vercel sets VERCEL=1). */
export const ON_VERCEL = process.env.VERCEL === '1';
/**
 * Catalogue (read-only). On Vercel the build writes it next to the gateway package
 * (`packages/gateway/data`, see the `vercel-build` script) so it ships with the function.
 */
export const CATALOGUE_DB_PATH = process.env.CATALOGUE_DB_PATH
  ? resolve(process.env.CATALOGUE_DB_PATH)
  : ON_VERCEL
    ? fileURLToPath(new URL('../data/catalogue.sqlite', import.meta.url))
    : resolve(DATA_DIR, 'catalogue.sqlite');
/** Orders + audit (writable). Vercel functions can only write to /tmp, which is per instance. */
export const GATEWAY_DB_PATH = process.env.GATEWAY_DB_PATH
  ? resolve(process.env.GATEWAY_DB_PATH)
  : ON_VERCEL
    ? '/tmp/gateway.sqlite'
    : resolve(DATA_DIR, 'gateway.sqlite');

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
  // Vercel hands the server its port in PORT; locally the gateway stays on 127.0.0.1:8787
  const port = Number(optionalEnv('GATEWAY_PORT') ?? (ON_VERCEL ? optionalEnv('PORT') : undefined) ?? 8787);
  const host = optionalEnv('GATEWAY_HOST') ?? (ON_VERCEL ? '0.0.0.0' : '127.0.0.1');
  return {
    port,
    host,
    publicUrl: publicBaseUrl(port),
    offerTtlMinutes: Number(optionalEnv('OFFER_TTL_MINUTES') ?? 30),
    knownAgents: DEFAULT_KNOWN_AGENTS,
    policyVersion: 'policy-0.1',
  };
}

/**
 * Public base URL of the deployment, used in the offer `issuer` (`<url>/.well-known/jwks.json`).
 * GATEWAY_PUBLIC_URL wins; on Vercel it is the production domain, else this deployment's URL.
 * The assistant computes the same value (packages/agent/src/assistant/server.ts) to pin the issuer.
 */
export function publicBaseUrl(port = 8787): string {
  loadEnv();
  const explicit = optionalEnv('GATEWAY_PUBLIC_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = ON_VERCEL ? (optionalEnv('VERCEL_PROJECT_PRODUCTION_URL') ?? optionalEnv('VERCEL_URL')) : undefined;
  return host ? `https://${host}` : `http://localhost:${port}`;
}
