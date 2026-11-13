# Build plan — for Gabri's confirmation

Status: **proposal, waiting for team confirmation** (2026-11-13). Background: [STRATEGY.md](STRATEGY.md) (why), [challenge-brief.md](challenge-brief.md) (what they ask), [portal-notes.md](portal-notes.md) (what the data/API really offers).

> **To Gabri's Claude:** please review this plan against the brief and the portal notes. Reply with ✅ / changes per section, especially §7 "Decisions to confirm". Don't start coding in folders owned by the other side (§5) without agreeing first.

## 1. Scope in one sentence
A **convincing prototype for the judges** (not a product Valio Aimo will run): an open, verifiable gateway that lets external AI purchasing agents look up, order at fixed prices and route decisions to human approval, plus a reference buyer agent, an approval app and a two-sided audit trail.

Prototype rules: local only, demo path rock-solid, everything else minimal; no user accounts, no security hardening, no scaling; assumptions **documented** instead of solved; "production" = a roadmap slide, not code.

## 2. What we build (checklist)
- [ ] **Aimo Agent Gateway** — REST + MCP bindings of the same tools
- [ ] **Signed offers** — every offer is a JWS/VC-shaped claim by Aimo (price, VAT, qty, available date, origin, labels, validUntil); key published via `did:web`
- [ ] **Fixed-price orders** — an order is accepted only if it matches a still-valid signed offer
- [ ] **Buyer mandate** — signed by the buyer's human: budget, categories, auto-approve limit, allowed substitutions, allergen hard rules
- [ ] **Policy engine on the gateway** (not in the LLM) → `auto_approved` | `needs_approval` | `blocked`, each with **reason codes**
- [ ] **Buyer logic** — request → structured need → shortlist → unit/pack math → ranking → partial fill + good-better-best substitutes (allergens = hard constraint)
- [ ] **Approval app** — phone-friendly queue showing cart, reason code, alternatives considered, why
- [ ] **Audit trail** — hash-chained, two views: buyer and Aimo
- [ ] **Open spec** — SPEC.md "Aimo Agent Commerce Protocol v0.1", generated OpenAPI, ASSUMPTIONS.md, small conformance test suite

Not building: chatbot as product, price negotiation, delivery-failure handling, recipe planning, standing-order drift, payments → "next steps" slide.

## 3. How it maps to the judging criteria
| Criterion (weight) | What they literally score | Our answer |
|---|---|---|
| End-to-end demo (30 %) | full request → lookup → order/approval flow in the mock environment, not isolated pieces | 4 scripted scenarios running through the real gateway + mock APIs; recorded fallback |
| Solving the need (20 %) | how precisely the agent matches the ask, **least manual correction** | structured need extraction, unit/pack conversion (litres → packs, rounding shown), delivery-date + cut-off aware, attributes like lactose-free matched exactly |
| Autonomy & controls (20 %) | what agent decides alone vs human sign-off, **how decisions are logged & auditable** | mandate + gateway policy, reason codes, approval app, hash-chained two-sided audit |
| Robustness (15 %) | partial availability, substitutions, **delivery constraints** | split across SKUs/packs, good-better-best, Terminal (unverified) stock, cut-off passed, sales block, available date later than needed |
| Openness & path to production (15 %) | open documented standards, **visible assumptions**, justified tech choices, credible next steps | MCP + OpenAPI + JWS/VC + did:web, SPEC.md, ASSUMPTIONS.md, ADR-style choices in SPEC, roadmap slide |

## 4. LLM usage (Claude credits: $20 per participant)
- **Deterministic core in code** (no LLM): search, unit/pack math, ranking, policy, signing, audit → precise, repeatable, cheap.
- **LLM only for:** free text → structured need, choosing between ranked finalists, writing the human-readable explanation.
- `LLM_PROVIDER = anthropic | openrouter | none` (one small `LLMProvider` interface)
  - dev: `openrouter` (free models) or `none`
  - demo: `anthropic` — `claude-haiku-5-5` for parsing, `claude-sonnet-5-5` for decisions/explanations (`claude-opus-5-5` only if needed)
  - fallback: `none` + recorded runs
- Each dev uses their own key in local `.env`; one key reserved for the demo with a spend limit. Never commit keys.
- **Second agent for the openness scene:** Claude Desktop / Claude Code connected to our MCP server.

## 5. Repo layout and ownership (proposed)
TypeScript monorepo (npm workspaces), Node 20+.
```
packages/
  shared/      Zod schemas, types, reason codes          — shared, change via PR only
  gateway/     Fastify REST + MCP server, catalogue, mock API client, orders   — Claudio
  trust/       jose signing/verification, did:web, mandates                    — Claudio
  policy/      policy engine + reason codes, audit chain                       — Claudio
  agent/       buyer agent: need extraction, ranking, substitution, LLMProvider — Gabri
  ui/          Vite + React: approval queue, buyer & Aimo audit views, request form — Gabri
  conformance/ test suite runnable against any client                         — whoever is free
scripts/       catalogue loader (portal JSON → SQLite, food only), demo scenarios
docs/          SPEC.md, ASSUMPTIONS.md, STRATEGY.md, PLAN.md, portal-notes.md
data/raw/      downloaded portal files (git-ignored)
```
Contract between the two sides = `packages/shared` + the gateway's REST/MCP API. Agree on it first (end of phase 1), then build in parallel.

## 6. Phases
| # | Phase | Est. | Output |
|---|---|---|---|
| 1 | Foundation | ~4 h | monorepo, Zod schemas, catalogue loader (food → SQLite), GS1 allergen map, mock API client with shortlist batching (≤1,000 IDs, no catalogue polling) |
| 2 | Gateway | ~6 h | `search_products`, `get_offers` (signed), `propose_order`, `approve`/`reject`, `get_order`, `explain` — REST + MCP |
| 3 | Trust & rules | ~6 h | JWS offers, did:web doc, mandate format, policy engine + reason codes, hash-chained audit |
| 4 | Buyer logic | ~5 h | need extraction, unit/pack math, ranking (price, date, reliability, CO₂, labels; unknown shown as unknown), partial fill + substitutes |
| 5 | UI | ~6 h | approval queue (mobile), buyer audit view, Aimo audit view, request form |
| 6 | Openness | ~3 h | SPEC.md, generated OpenAPI, ASSUMPTIONS.md, conformance suite |
| 7 | Demo hardening | last ~8 h | 4 scenarios scripted, rogue-agent script, recorded fallback, slides, **feature freeze** |

Phases 2–3 (Claudio) and 4–5 (Gabri) run in parallel after phase 1.

### Draft gateway tools
- `search_products({ text?, attributes[], free_from_allergens[], category?, unit? })` → candidates from local catalogue (no live calls)
- `get_offers({ product_ids[], quantity, unit, delivery_date })` → live price + availability for the shortlist only → **signed offers**
- `propose_order({ offer_ids[], quantities[], mandate })` → policy → `auto_approved | needs_approval | blocked` + reason codes
- `approve_order / reject_order({ order_id, approver })` — human only, from the UI
- `get_order({ order_id })`, `explain({ order_id })` → human-readable decision record

### Draft reason codes
`OVER_BUDGET`, `OVER_AUTO_LIMIT`, `SUBSTITUTION_OUTSIDE_PREFS`, `ALLERGEN_CONFLICT` (always blocked), `UNVERIFIED_STOCK` (Terminal), `PARTIAL_AVAILABILITY`, `AFTER_CUTOFF`, `DELIVERY_LATER_THAN_NEEDED`, `SALES_BLOCK`, `OFFER_EXPIRED`, `OFFER_SIGNATURE_INVALID`, `MANDATE_EXPIRED`, `UNKNOWN_AGENT`, `QUERY_BUDGET_EXCEEDED`.

## 7. Demo (4 scenes, ~2.5 min)
1. **Happy path** — hotel: "1,000 L lactose-free milk by Monday" → shortlist → signed offers verified → within mandate → auto-approved → audit entry.
2. **Exception** — hospital kitchen: partial / unverified stock → allergen-safe good-better-best → approval on phone with reason code → approve → order placed.
3. **Attack** — rogue agent: tampered price / expired mandate / prompt injection in a product description → blocked → visible in Aimo's audit view.
4. **Openness** — Claude Desktop over MCP places an order through the same spec; conformance suite passes.

## 8. Decisions to confirm (Gabri)
1. Stack: TypeScript, npm workspaces, Fastify, `@modelcontextprotocol/sdk`, Zod, `jose`, `better-sqlite3`, Vite + React, Vitest — ✅ / change?
2. Ownership split in §5 — ✅ / swap?
3. Git: feature branches + PRs into `main`, small PRs, nobody pushes directly to `main` — ✅ / change?
4. Demo personas: hotel (milk) + hospital (allergen-safe) — ✅ / other?
5. Local only, no deployment — ✅ / deploy at the end?
6. LLM split (Haiku parse, Sonnet decide, OpenRouter free for dev) — ✅ / change?
7. Anything in the brief or portal notes we missed?
8. Submission deadline and format (live / video) — from the Junction platform.
