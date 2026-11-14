# Junction 2026 — Valio Aimo "Trusted Trade Agents"

Prototype of a trust layer that lets external AI purchasing agents look up, order at fixed prices, and get the right human approval from Valio Aimo — on open, verifiable standards.

## Start here
- [docs/challenge-brief.md](docs/challenge-brief.md) — the challenge, judging criteria, mentors
- [docs/portal-notes.md](docs/portal-notes.md) — digest of the resource portal: mock API reference, datasets, field coverage
- [docs/PLAN.md](docs/PLAN.md) — **final build plan to confirm**: scope, ownership, phases, reason codes, decisions
- [docs/RECIPE-STEP.md](docs/RECIPE-STEP.md) — chef request "dish + servings" → ingredient lines (agent, for Step 7/9)
- [docs/VIDEO.md](docs/VIDEO.md) — submission video storyboard (2:00) + catalogue/data check for the demo menu
- [docs/STRATEGY.md](docs/STRATEGY.md) — why: differentiators, architecture, demo script

## Secrets
Copy `.env.example` to `.env` and fill in values from the Junction platform. `.env` is git-ignored — never commit the API key.

## Develop
Node ≥ 22.12 (`.nvmrc`), npm workspaces:

| Package | What | Owner |
|---|---|---|
| `packages/shared` | Integration contract: Zod schemas, reason codes, the 7-tool registry, fixtures (`@junction/shared/fixtures`) | both — PR + other's ✅ |
| `packages/gateway` | Fastify REST + MCP, trust, policy, audit | Claudio |
| `packages/agent` | Buyer agent | Gabri |
| `packages/ui` | Vite + React approval app | Gabri |

```sh
npm install
npm test           # builds shared, then Vitest across all workspaces
npm run typecheck  # tsc strict, all workspaces
npm run dev:ui
```

## License
[MIT](LICENSE)
