# Strategy — how we win "Trusted Trade Agents"

Status: **proposal for team review** (2026-11-13). Inputs: [challenge-brief.md](challenge-brief.md), [portal-notes.md](portal-notes.md).

## 1. The key insight
Valio Aimo is the judge **and the seller**. They want to *define how an outside agent may work with their systems*, keep **data ownership** and the **customer relationship**, on open standards. ~2,000 participants get the same brief; most will build "Claude + MCP + a spend threshold + a chat window". We build **the trust layer Aimo would put in front of its webshop**, plus a reference buyer agent that proves it.

One-liner: *"Verifiable commerce for agents — Aimo stays in control of its data, buyers stay in control of their spend, and nobody has to trust the AI blindly."*

## 2. What the portal tells us (summary of portal-notes.md)
- Mock backend is **read-only**: `POST /api/price`, `POST /api/availability` (≤1,000 IDs, `X-API-Key`), `GET /api/ping`, plus download redirects. **No order/quote/cart/customer/approval endpoints** → the whole order + approval + trust layer is ours to build (this is good: it is exactly our differentiator).
- `customer` is ignored and responses look date-insensitive → customer tiers, price/stock drift are simulated in our layer.
- 17,546 products (87 MB JSON), delivery reliability CSV (25 % coverage), carbon CSV (63 %, group averages).
- Price: list vs catalogue price, `validFrom/validTo`, VAT, comparison price per kg/L → good material for **signed offers**.
- Availability: `closingTime` (cut-off), `salesBlock`, `logisticModel` Stock vs **Terminal (always 999999 = unverified qty)**, `availableAmount`, `availableDate` → good **reason-code triggers**.
- Allergens as GS1 codes (CONTAINS / MAY_CONTAIN / FREE_FROM) — we must write the code→name map. 4,178 lactose-free products. Labels (EU organic, Svanen, MSC, Fairtrade, Finnish origin), origin, supplier present. Native substitutions only for 189 products → we compute our own.
- No customer order history → standing-order drift would be fully synthetic → **dropped**.
- Rate limits undisclosed; organisers forbid polling the catalogue → **load catalogue locally, call live API only for the shortlist**.

## 3. What everyone else will build (don't compete there)
- A chat UI as the product (brief says twice: *not a chatbot*)
- Approval = "if > €X ask a human"
- SKU-for-SKU substitution, delivery-failure handling (last year's challenge), price negotiation (they want **fixed prices**)

## 4. Our differentiators (from the "Insight" section — the jury's real wish list)
1. **Trust protocol (headline).** Every offer the gateway returns is a **signed claim** (JWS, shaped like a W3C Verifiable Credential 2.0): SKU, price, VAT, qty available for date X, origin, labels, `validUntil`. Aimo's public key is published via **did:web**. The buyer agent verifies before acting; at order time the gateway checks the order matches a still-valid signed offer → price is fixed and provable on both sides.
2. **Buyer mandate.** The buyer's human signs a **mandate credential** (budget, categories, allowed substitutions, allergen hard rules, auto-approve limits). The agent presents it with each order; the gateway enforces it. *Policy lives on the gateway, not in the LLM — a jailbroken agent still can't break the rules.*
3. **Two-layer guardrails with reason codes.** Buyer rules (mandate) + Aimo rules (credit limit, unusual qty, unverified Terminal stock, past cut-off, sales block, expired price, new/unknown agent). Approval card shows *which* reason code fired.
4. **Data ownership / tiered disclosure.** Agents register (A2A-style agent card) tied to a customer account. Anonymous → public catalogue; registered + valid mandate → customer prices & stock; nobody → supplier internals/roadmap. Per-agent query budgets (answers "query only when needed" from Aimo's side). Revocable.
5. **Good-better-best with hard allergen constraints.** On partial availability: split across SKUs/pack sizes, or rank substitutes by attribute match, price, reliability, CO₂, labels. Allergens are **hard constraints** the agent can never override. Missing reliability/CO₂ data is shown honestly as "unknown", never invented.
6. **Two-sided audit trail.** One hash-chained log, two views: buyer ("what my agent did and why") and Aimo ("which agents ordered what under which mandate").
7. **Ship it as a spec.** "Aimo Agent Commerce Protocol v0.1": endpoints, signed-offer format, mandate format, reason codes. Two bindings (REST/OpenAPI + MCP) of one spec, plus a **conformance test suite** any agent vendor can run. This is the "openness & path to production" 15 %.

Out of scope (mention as "next" on a slide): proactive selling agent, recipe planning, standing-order drift, payments (x402 etc.).

## 5. Stack (agreed: TypeScript, per Gabriele's proposal + additions)
| Piece | Choice |
|---|---|
| Language | TypeScript everywhere, Node.js |
| Schemas | **Zod**, shared by REST, MCP and UI; generate OpenAPI from them |
| Aimo Gateway REST | Fastify (or Hono) + OpenAPI docs |
| Agent interface | MCP server via `@modelcontextprotocol/sdk` — same tools as REST |
| Trust layer | **`jose`** for JWS signing/verification, `did:web` document for Aimo's key |
| Policy | JSON policy + TS evaluator returning reason codes |
| Data + audit | SQLite (`better-sqlite3`): food-filtered catalogue loaded at startup; hash-chained audit table |
| Buyer agent | Claude via Anthropic SDK tool use, connecting **through the MCP server** |
| UI | Vite + React: **approval queue + audit trail are the main screens** (phone-friendly); request input is a form / single box, chat at most a side panel |
| Tests | Vitest; conformance suite runnable against any agent/client |

Secrets only in `.env` (see `.env.example`). Never commit the API key.

## 6. Architecture
```
 Buyer human ──signs mandate──┐                       ┌── Aimo staff view (audit, agents, revoke)
                              ▼                       │
 Buyer agent (Claude) ──MCP/REST──▶  AIMO AGENT GATEWAY ──▶ mock APIs (price, availability)
   verifies signed offers           ├ agent registry + tiered disclosure
                                    ├ catalogue search (local SQLite, food only)
                                    ├ offer signer (JWS / VC, did:web)
                                    ├ policy engine (mandate + Aimo rules → reason codes)
                                    ├ order store (fixed price from signed offer)
                                    └ hash-chained audit log ──▶ Approval UI (phone)
```

Gateway tools / endpoints (draft):
- `search_products(query, attributes[], allergens_free[], unit, category)` → candidates from local catalogue
- `get_offers(product_ids[], qty, delivery_date)` → calls live price+availability for the shortlist only, returns **signed offers**
- `propose_order(offer_ids[], quantities, mandate)` → policy check → `approved` | `pending_approval{reason_codes}` | `rejected{reason_codes}`
- `get_order_status(order_id)`; `explain(order_id)` → human-readable decision record
- Human side: `approve/reject(order_id)` from the UI

## 7. Demo script (30 % of score — rehearse it)
1. **Happy path (30 s):** hotel agent, "1,000 L lactose-free milk by Monday" → shortlist → signed offers verified → within mandate → auto-ordered → audit entry.
2. **Exception (60 s):** hospital kitchen, partial stock / Terminal (unverified) qty → good-better-best, allergen-safe alternatives → approval card on a phone with reason code → tap approve → order placed.
3. **Attack (45 s):** rogue agent with tampered offer price / expired mandate / prompt injection in a product description → gateway blocks it → visible in Aimo's audit view.
4. **Openness (15 s):** a second, different client passes the conformance suite against the same spec.

Freeze features ~8 h before deadline; record a backup video.

## 8. Team split (4 people, adjust)
- **A — Gateway:** REST + MCP, catalogue loader/search, mock API client with shortlist batching
- **B — Trust & policy:** signing/verification, did:web, mandate format, policy engine, reason codes, audit chain
- **C — Buyer agent:** Claude tool loop, request parsing, ranking + substitution logic, explanation text
- **D — UI + pitch:** approval queue, two audit views, demo script, slides, video

## 9. Open questions for mentors (ask early, quote answers in pitch)
- Which approval rules do real kitchens use today (budget owners, order limits, substitution policies)?
- Which claims (price, stock, origin, labels) would Aimo actually be willing to sign?
- What must an external agent **never** see? (data governance — Tommi Nurmi-Aro, Ville Takanen, Riku Tapper)
- Is "Terminal" stock really unverifiable at order time?
- Judging/submission format and deadline (not on the portal — check Junction platform).
