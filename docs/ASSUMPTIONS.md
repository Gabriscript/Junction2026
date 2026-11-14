# Assumptions and simulated behaviour

Everything the prototype does that the Valio Aimo mock API / dataset does **not** do for real, or where we had to choose an interpretation. Judges and reviewers: this is the honest list. Owner: Claudio (gateway); Gabri adds agent/UI items via PR.

## Mock API (portal) behaviour we work around
1. **Customer is ignored by the mock.** `customer` is sent with every price/availability call (real prices are customer-specific) but every customer gets identical answers. Customer tiers (`netPriceFound`, list vs catalogue price) are therefore modelled in our offers, not live.
2. **Responses are date-insensitive.** The mock returns the same `availableDate` / `closingTime` regardless of `requestedDate` (observed: `requestedDate` 2026-11-17 → `availableDate` 2026-11-16). `closingTime` may already be in the past. We treat them as data and raise `DELIVERY_LATER_THAN_NEEDED` / `AFTER_CUTOFF` only from what the API says.
3. **Price validity is not enforced by the mock** (`validTo` 2026-12-31 still priced in 2027). Our signed offer's `validUntil` = min(issuedAt + `OFFER_TTL_MINUTES` (30), Aimo `catalogPrice.validTo`); the fixed-price guarantee is **our** JWS, not backend behaviour.
4. **Terminal logistics report `availableAmount` 999999** (and some Stock lines 9999999999 = unlimited). Terminal quantities are marked `quantityVerified: false` → `UNVERIFIED_STOCK` (needs approval). Stock quantities are taken at face value.
5. **No order / checkout / cart endpoints exist.** Orders, approvals, mandates and audit live entirely in the gateway's SQLite (`data/gateway.sqlite`). "Placing" an auto-approved or approved order means recording it at the signed prices; nothing is sent to Aimo.
6. **Unknown product ids return 200** (`error: true` / empty `scheduleLines`). We validate ids against the local catalogue first (`UNKNOWN_PRODUCT`) and surface `NO_PRICE` / `NOT_DELIVERABLE` from the API answers.
7. **Rate limits are undisclosed.** The gateway never polls the catalogue: `search_products` is local SQLite/FTS5; `get_offers` accepts ≤ 50 shortlist items, batches ≤ 1,000 ids per call and caches responses 10 min per (date, id).

## Dataset interpretation
8. **Food-only filter is a heuristic** (no category names in the data): products with chemical `safetyData` are never food; Finnish reduced VAT (`vatCode` MEDIUM/LOW) = food; STANDARD = non-food; otherwise food only if nutrition/allergen/claim data exists. Result: 12,580 of 17,546 products.
9. **GS1 allergen code → name map is hand-written** (shared `GS1_ALLERGEN_NAMES` + gateway extras). Unmapped codes are shown verbatim, never guessed.
10. **Allergen safety rule**: a product is safe for code X if it has an explicit `FREE_FROM X`, or it has *some* allergen data and no `CONTAINS`/`MAY_CONTAIN X`. **No allergen data at all = unknown = unsafe** (`ALLERGEN_CONFLICT`, blocked; excluded from `freeFromAllergens` searches). Codes are matched literally (forbidding `UW` does not automatically forbid `AW`).
11. **Dietary attributes** are normalised from `nutritionalClaim` ids: `FREE_FROM_LACTOSE → LACTOSE_FREE`, `FREE_FROM_GLUTEN → GLUTEN_FREE`, `NO_ADDED_SUGARS → NO_ADDED_SUGAR`, `LOW_SODIUM_SALT → LOW_SALT`, `VEGAN`, `VEGETARIAN`, … Temperature markers (`coolTemperature` etc.) are dropped from `labels`.
12. **Net content** per sales unit = base-unit volume/weight (`unitConversions` BASE_UNIT_OR_EACH; `MLT`/`CLT`→L, `GRM`→KG, `H87`→ST) × `units[].sizeInBaseUnits`; KG-sold / variable-weight items = 1 KG per unit. Missing = `null`.
13. **Reliability (25 %) and carbon (63 %) are joined as-is**; missing = `null`, shown as unknown, never defaulted. Carbon is a product-group average, not a measurement.
14. Catalogue data is loaded once (`npm run load-catalogue`) into git-ignored `data/`; the dataset never enters the repo (fixtures use ids `99xxxx` outside the real range).

## Trust and policy (our protocol, v0.1)
15. **Static agent list** (`DEFAULT_KNOWN_AGENTS` in `packages/gateway/src/config.ts`) stands in for an agent registry: agent id + allowed customer numbers + query budget per hour. Unknown agent or wrong customer → `UNKNOWN_AGENT` (blocked / HTTP 403). Budget exceeded → `QUERY_BUDGET_EXCEEDED` (HTTP 429, and blocked on later proposals within the hour).
16. **Mandates are unsigned JSON** carried in every `propose_order` (v0.1). Signing them by the buyer is a documented next step. The mandate's `agentId` must equal the calling agent.
17. **Offers are JWS ES256** over `canonicalJson(offer)`; key from `AIMO_SIGNING_KEY` in `.env` or generated on first run and appended to `.env` (git-ignored); public key at `/.well-known/jwks.json`. `did:web` is stretch.
18. **Severities** follow the shared contract defaults; the engine only escalates: `OVER_BUDGET` becomes blocked when the order alone exceeds 2× the whole mandate budget. `ALLERGEN_CONFLICT` is always blocked and cannot be approved by anyone.
19. **Missing required attribute** (e.g. mandate requires `LACTOSE_FREE`, line lacks it) and **category outside `allowedCategories`** are reported as `SUBSTITUTION_OUTSIDE_PREFS` (needs approval) — the contract has no dedicated code.
20. **Offers quoted for another customer** than the mandate's are rejected as `OFFER_SIGNATURE_INVALID` (the signed payload does not bind to this buyer).
21. **Budget** = gross of `auto_approved` + `approved` orders under the same `mandateId` in this gateway's database (no external spend data).
22. **Proposals with no verifiable line** (every offer tampered/expired, or unknown agent) are rejected with HTTP 422 and audited (`offer_rejected` / `agent_rejected`, Aimo-only visibility for unknown agents) instead of creating an order.
23. **Approve/reject are human-only**: REST only (approver `type` must be `human`), never registered as MCP tools; MCP calls to them return an error.
24. **Audit chain** is a single sequence in SQLite (sha256 over the shared `auditHashInput`). Buyer view = events tagged `buyer` for their `customerRef`; Aimo view = everything. The gateway operator could rewrite the whole chain consistently — anchoring the head hash externally is a next step.
25. **MCP over HTTP is stateless** (fresh server per request, JSON responses); stdio transport is available for Claude Desktop. Time is the gateway clock (UTC ISO strings in offers/orders; Aimo `+0200` offsets normalised to `+02:00`).

## Recipe step (agent, `packages/agent/src/recipe/`)
- Portion sizes come from an LLM or a fixed demo table and are clamped to rough professional-kitchen bounds per ingredient kind (e.g. pasta 60–150 g per serving).
- Ready-made components (e.g. pesto) are assumed unless the chef says otherwise.
- Missing servings → 1 serving; missing date → next available delivery. Both are shown to the chef as assumptions.
- No pantry/stock awareness and no recipe adaptation to allergens; allergen safety is enforced by the mandate and the gateway policy.
- Menus: dishes are split on commas, semicolons, colons and new lines; identical ingredients across dishes are merged into one line. Gelato is one ~70 ml scoop per flavour (two scoops if one flavour).
