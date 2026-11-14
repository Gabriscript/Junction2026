/**
 * Gateway signing key (ES256 / P-256).
 *
 * Loaded from `AIMO_SIGNING_KEY` (a private JWK as JSON) in `.env`. When absent, a key pair is
 * generated on first run and appended to the git-ignored `.env` so offers stay verifiable
 * across restarts. The private key is never logged, never leaves this process.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from 'jose';
import { ENV_FILE, optionalEnv } from '../config.js';

export const SIGNING_ALG = 'ES256';

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JWK;
}

export interface Jwks {
  keys: JWK[];
}

function isPrivateEcJwk(j: unknown): j is JWK {
  return !!j && typeof j === 'object' && (j as JWK).kty === 'EC' && (j as JWK).crv === 'P-256' && typeof (j as JWK).d === 'string';
}

async function fromPrivateJwk(jwk: JWK): Promise<SigningKey> {
  const privateKey = (await importJWK(jwk, SIGNING_ALG)) as CryptoKey;
  const { d: _d, ...pub } = jwk;
  const kid = jwk.kid ?? (await calculateJwkThumbprint(pub));
  const publicJwk: JWK = { ...pub, kid, alg: SIGNING_ALG, use: 'sig' };
  const publicKey = (await importJWK(publicJwk, SIGNING_ALG)) as CryptoKey;
  return { kid, privateKey, publicKey, publicJwk };
}

/** Generate a fresh key pair (tests, or first run). */
export async function generateSigningKey(): Promise<{ key: SigningKey; privateJwk: JWK }> {
  const pair = await generateKeyPair(SIGNING_ALG, { extractable: true });
  const privateJwk = await exportJWK(pair.privateKey);
  const kid = await calculateJwkThumbprint({ kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y });
  const jwk: JWK = { ...privateJwk, kid };
  return { key: await fromPrivateJwk(jwk), privateJwk: jwk };
}

export interface LoadKeyOptions {
  /** Where to persist a generated key. Default: repo `.env`. `null` = do not persist. */
  envFile?: string | null;
  envVar?: string;
}

/**
 * Load the signing key from the environment, generating + persisting one if missing.
 * The generated key is written only to `.env` (git-ignored); nothing is printed.
 */
export async function loadSigningKey(opts: LoadKeyOptions = {}): Promise<SigningKey> {
  const envVar = opts.envVar ?? 'AIMO_SIGNING_KEY';
  const raw = optionalEnv(envVar);
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${envVar} is not valid JSON (expected a private EC P-256 JWK)`);
    }
    if (!isPrivateEcJwk(parsed)) throw new Error(`${envVar} must be a private EC P-256 JWK`);
    return fromPrivateJwk(parsed);
  }
  const { key, privateJwk } = await generateSigningKey();
  const envFile = opts.envFile === undefined ? ENV_FILE : opts.envFile;
  if (envFile) {
    const prefix = existsSync(envFile) ? '\n' : '';
    appendFileSync(envFile, `${prefix}# gateway offer-signing key (generated ${new Date().toISOString()}); never commit\n${envVar}='${JSON.stringify(privateJwk)}'\n`, { mode: 0o600 });
  }
  process.env[envVar] = JSON.stringify(privateJwk);
  return key;
}

export function jwksFor(key: SigningKey): Jwks {
  return { keys: [key.publicJwk] };
}
