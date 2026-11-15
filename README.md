# Junction 2026 — Valio Aimo "Trusted Trade Agents"

Kitchens will soon send AI agents to do their wholesale ordering. We build the trust layer Valio Aimo would put in front of its webshop: an open gateway (REST + MCP, one spec) where external agents search products, receive signed fixed-price offers (JWS), and propose orders. A policy engine on the gateway, not in the LLM, checks each order against the buyer's mandate (budget, auto-approve limit, allowed substitutions, allergen hard rules) and Aimo's rules, then returns auto-approved, needs-approval or blocked, always with reason codes. Approvals happen on a phone; every decision lands in a hash-chained audit trail with a buyer view and an Aimo view. Mikko, our reference buyer agent, handles partial availability by topping up with substitutes. It only proposes allergen-safe ones, checked against GS1 data, so the chef decides with the facts in front of them.

**Live demo:** https://junction2026-ddp8.vercel.app/

## Start here
- [docs/DEMO-RUN.md](docs/DEMO-RUN.md) — **run the live demo**: webshop → AI Assistant → real gateway (3 local processes)
- [docs/challenge-brief.md](docs/challenge-brief.md) — the challenge, judging criteria, mentors
- [docs/portal-notes.md](docs/portal-notes.md) — digest of the resource portal: mock API reference, datasets, field coverage
- [docs/PLAN.md](docs/PLAN.md) — **final build plan to confirm**: scope, ownership, phases, reason codes, decisions
- [docs/RECIPE-STEP.md](docs/RECIPE-STEP.md) — chef request "dish + servings" → ingredient lines (agent, for Step 7/9)
- [docs/VIDEO.md](docs/VIDEO.md) — submission video storyboard (2:00) + catalogue/data check for the demo menu
- [docs/VIDEO-SCRIPT.md](docs/VIDEO-SCRIPT.md) — shot-by-shot script with Gemini/Veo prompts + real recordings list
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
