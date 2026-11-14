# Deploy on Vercel (multi-service)

One Vercel project, three services, defined in [`vercel.json`](../vercel.json).

| Service | Root | What it is | Public paths |
|---|---|---|---|
| `web` | `packages/ui/` | Vite build: dashboard (`/`) and Aimo webshop (`/shop.html`) | `/` (catch-all, last) |
| `gateway` | `deploy/gateway/` (code: `packages/gateway`) | Fastify: REST, signed offers, policy, audit, MCP | `/v1/*`, `/.well-known/*`, `/docs`, `/mcp` |
| `assistant` | `deploy/assistant/` (code: `packages/agent`) | Mikko: menu → order, scan, SSE relay | `/api/*` |

Binding: `assistant` → `gateway` as `GATEWAY_URL` (internal URL, injected at runtime).
Services see the original path (no prefix stripping), so the code's routes match the public paths.

## Environment variables (Vercel project settings)

| Variable | Needed by | Note |
|---|---|---|
| `AIMO_API_KEY` | gateway (build + runtime) | build downloads the portal dataset and builds the catalogue |
| `AIMO_SIGNING_KEY` | gateway | private EC P-256 JWK, the same value as in the local `.env`. Required on Vercel: the gateway refuses to generate one per instance |
| `GEMINI_API_KEY` | assistant | Gemini for scan and recipes (or `ANTHROPIC_API_KEY`) |
| `GATEWAY_PUBLIC_URL` | gateway + assistant | optional; the offer issuer. Default: the production domain, else the deployment URL |

## What the build does

The backend services do not deploy the TypeScript packages directly: Vercel guessed the entrypoint by name (`src/index.ts`, the library barrel, wins over `src/server.ts`) and ran the ESM output as CommonJS. Each backend root under `deploy/` holds only `index.cjs` (the one entrypoint candidate) and a `package.json` whose `vercel-build` writes `dist/server.cjs`: one self-contained CommonJS bundle (`npm run bundle:vercel`, esbuild; `@junction/shared` and all npm deps inlined, `node:*` builtins external).

- `gateway`: `vercel-build` runs `npm run load-catalogue` (builds `packages/shared`, downloads the dataset into `data/raw`, writes `packages/gateway/data/catalogue.sqlite`), then bundles. The catalogue and the swagger-ui assets are embedded in the bundle and written to the function's tmp dir at cold start, so nothing depends on Vercel's file tracing.
- `assistant`: builds `packages/shared`, then bundles.
- `web`: builds `packages/shared`, then `VITE_GATEWAY_URL=/ vite build` (live mode, same origin).

## Limits (demo, not production)

- Orders and the audit log live in `/tmp/gateway.sqlite`, one per function instance. They are lost on a cold start and not shared between instances. Fine for a demo; production needs a real database.
- SSE (`/api/events`, `/v1/audit/stream`) is cut when the function reaches its max duration; the UI reconnects.

Checked locally by simulating Vercel (`VERCEL=1`, `PORT`, `VERCEL_URL`, binding `GATEWAY_URL`, read-only catalogue): orders are placed with verified signed offers. Not yet deployed for real.
