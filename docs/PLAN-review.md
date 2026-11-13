# PLAN review — Gabri's answers + work split

Status: **review of [PLAN.md](PLAN.md) (commit `8ffcfa9`)**, 2026-11-13. Overall: ✅ solid, aligned with brief, judging criteria and portal notes. Changes below are mostly scope cuts so we finish in the ~37 h left.

## 1. Per-section review
- **§1 Scope** — ✅ "prototype for the judges, assumptions documented" is right.
- **§2 What we build** — ✅ with one change: **`did:web` becomes stretch**. Start with a JWKS at `/.well-known/jwks.json` (standard, ~10 lines). Add `did:web` on Sunday if time allows, otherwise it goes on the "next steps" slide.
- **§3 Criteria mapping** — ✅ Unit/pack math (litres → packs, rounding shown) is the detail that scores on "least manual correction".
- **§4 LLM** — ✅ deterministic core + LLM only where needed. OpenRouter free models for dev are fine (data is synthetic).
- **§5 Repo layout** — simplify to **4 packages**: `shared`, `gateway` (with `trust/` and `policy/` as internal folders), `agent`, `ui`. `conformance` → Claudio, stretch (an owner of "whoever is free" means nobody).
- **§6 Phases** — ✅ but **time risk**: Claudio ~12 h + Gabri ~11 h + pitch/video + 4 h foundation + 8 h hardening exceeds what is left. Planned cuts:
  - `UNKNOWN_AGENT` / `QUERY_BUDGET_EXCEEDED` via a **static agent list** in config, no registry.
  - Demo scene 4: Claude Desktop over MCP is enough; conformance suite is stretch.
- **§7 Demo** — ✅ 4 scenes ≈ 2.5 min. ⚠ The **submission video is max 2:00** (strict). We need two cuts: the 2:00 video and the 3:00 live pitch.

## 2. Answers to §8
1. Stack — ✅
2. Ownership — ✅ with the 4-package layout (§3 below).
3. Git — ✅ feature branches + PRs into `main`, small PRs, **self-merge allowed** for small PRs (waiting for review at night blocks us). PRs touching `packages/shared` need the other person's ✅.
4. Personas hotel (milk) + hospital (allergen-safe) — ✅
5. Local only — ✅ for the stage demo (we present from our own laptop). ⚠ Submission asks for a "demo link": the public video covers it; deploy at the end only if time allows.
6. LLM split — ✅
7. Missed items:
   - Repo must be **public, MIT license** → add `LICENSE`.
   - **Dataset never in the repo** (`data/raw` git-ignored ✅): portal says it must not be used outside the challenge.
   - **JWS signing key in `.env`**, generated on first run if missing; never committed.
8. Deadlines and format (Participant Guidebook):
   - **Draft project on the platform by Fri 13.11 23:59** (team count + challenge).
   - **FINAL by Sun 15.11 10:00**, no late submissions. Required: name, punchline, description, challenge, technologies, **public video ≤ 2:00**, demo + source links, pitch deck PDF, phone numbers, Discord usernames.
   - **Live peer review Sun 10:30–14:00, both present**, otherwise not eligible for the main prize.
   - Top 5: 3 min pitch + 3 min questions, demo from own laptop.

## 3. Ownership (no overlap)
| Path | Owner |
|---|---|
| `packages/shared/` | both — PR + other's ✅ |
| `packages/gateway/` (incl. `src/trust/`, `src/policy/`, `src/audit/`) | Claudio |
| `scripts/load-catalogue.ts` | Claudio |
| `packages/agent/` | Gabri |
| `packages/ui/` | Gabri |
| `scripts/demo/` | Gabri |
| `docs/SPEC.md`, `docs/ASSUMPTIONS.md` | Claudio (Gabri adds agent/UI assumptions via PR) |
| pitch deck, video | Gabri |

Integration contract = `packages/shared` + gateway REST/MCP. Until the gateway is live, the agent and UI run against a **mock gateway** built from the shared schemas.

## 4. Work split — steps

### Step 1 — Contract and monorepo (both, ~1 h, Fri night)
Owner: both, pair. npm workspaces with `shared`, `gateway`, `agent`, `ui`; Vitest; `LICENSE` (MIT). In `packages/shared`: Zod schemas `Product`, `SignedOffer`, `Mandate`, `OrderProposal`, `Decision` (`auto_approved | needs_approval | blocked` + `reasonCodes[]`), `AuditEvent`, `ReasonCode` enum, input/output schemas of the 7 gateway tools.
Acceptance: `npm test` passes in all workspaces; schemas exported and imported by `gateway` and `agent`.

### Step 2 — Catalogue loader (Claudio)
Implement `scripts/load-catalogue.ts`: portal JSON → SQLite (food only), FTS5 search index, GS1 allergen code → name map, join delivery reliability + carbon CSV (missing = null).
Acceptance: loader runs once in < 2 min; FTS query "lactose free milk" returns lactose-free products; nulls kept, never invented.

### Step 3 — Mock API client (Claudio)
Implement price + availability client in `packages/gateway`: `X-API-Key` from `.env`, shortlist batching ≤ 1,000 IDs, in-memory cache, no catalogue polling, errors surfaced.
Acceptance: unit tests with recorded fixtures pass; a batch > 1,000 is split; missing key fails fast with a clear message.

### Step 4 — Trust: signed offers (Claudio)
Implement `src/trust/`: sign offers as JWS (`jose`), VC-shaped payload (price, VAT, qty, availableDate, origin, labels, validUntil); key from `.env` or generated on first run; publish `/.well-known/jwks.json`; verify helper exported for the agent.
Acceptance: sign → verify roundtrip test; tampered price → `OFFER_SIGNATURE_INVALID`; expired → `OFFER_EXPIRED`.

### Step 5 — Policy engine + audit chain (Claudio)
Implement `src/policy/` (mandate + Aimo rules → decision + reason codes from PLAN §6) and `src/audit/` (hash-chained SQLite table, buyer and Aimo views).
Acceptance: one test per reason code; `ALLERGEN_CONFLICT` always `blocked`; altering any audit row breaks chain verification.

### Step 6 — Gateway REST + MCP (Claudio)
Implement the 7 tools (`search_products`, `get_offers`, `propose_order`, `approve_order`, `reject_order`, `get_order`, `explain`) once, bound to Fastify REST (OpenAPI generated from Zod) and an MCP server (`@modelcontextprotocol/sdk`); SSE stream of audit events for the UI.
Acceptance: happy path works via REST and via MCP (Claude Desktop); OpenAPI served at `/docs`.

### Step 7 — Buyer agent core (Gabri)
Implement `packages/agent`: `LLMProvider` (`anthropic | openrouter | none`), free text → structured need (Zod-validated), unit/pack math, tool loop against gateway (mock first), verify signed offers before ordering.
Acceptance: "1,000 L lactose-free milk by Monday" → valid need JSON; pack rounding shown; with `LLM_PROVIDER=none` a fixture need still runs end to end.

### Step 8 — Ranking and substitution (Gabri)
Implement good-better-best ranking in `packages/agent` (price, available date vs needed, reliability, CO₂, labels; unknown shown as unknown), partial fill across SKUs/packs, allergens as hard constraint (unknown allergen data = unsafe).
Acceptance: tests: partial stock → split proposal; substitute with forbidden allergen never proposed; missing reliability displayed as "unknown".

### Step 9 — Approval app and audit views (Gabri)
Implement `packages/ui` (Vite + React, phone-first): approval queue (cart, reason codes, alternatives, why) with approve/reject, buyer audit view, Aimo audit view, request form; live updates via SSE.
Acceptance: approve on a 375 px phone viewport updates order status and audit view without reload; keyboard and screen-reader usable buttons.

### Step 10 — Demo scenarios and pitch (Gabri)
Implement `scripts/demo/` for the 4 scenes (happy, exception, attack, openness), rogue-agent script, recorded fallback run; pitch deck PDF; 2:00 video and 3:00 live pitch.
Acceptance: each scene runs from one command; video ≤ 2:00; deck exported to PDF.

### Step 11 — Openness docs and conformance (Claudio, stretch)
Write `docs/SPEC.md` ("Aimo Agent Commerce Protocol v0.1"), `docs/ASSUMPTIONS.md`, optional conformance suite runnable against any client, optional `did:web`.
Acceptance: SPEC lists tools, signed-offer and mandate formats, reason codes; ASSUMPTIONS lists every simulated behaviour.

## 5. Milestones
| When | Done |
|---|---|
| Fri 23:59 | Step 1 + draft submission on the platform |
| **Sat 14:00** | **happy path end to end through real gateway** (steps 2–7 minimal) |
| Sat 22:00 | exceptions, approval on phone, attack scene (steps 5, 8, 9) |
| **Sun 02:00** | **feature freeze** |
| Sun 08:00 | video recorded |
| Sun 09:30 | submission set to FINAL (deadline 10:00) |

Fallback: if steps 4–5 slip past Sat 12:00, Gabri takes the audit chain (`src/audit/`) by agreement.
