# Aimo Agent Commerce Protocol v0.1 — outline

Status: outline only (Step 11, stretch). The normative source is `packages/shared/src` (Zod schemas) and the generated OpenAPI at `http://localhost:8787/docs`.

1. **Scope** — how an AI purchasing agent discovers products, obtains verifiable fixed-price offers and places orders with Valio Aimo under a buyer mandate; how humans approve; how both sides audit.
2. **Roles** — buyer organisation (issues mandate, approves), agent (calls tools), Valio Aimo gateway (signs offers, enforces policy, keeps the audit chain).
3. **Transports** — REST (`/v1/...`, OpenAPI 3.1 generated from Zod) and MCP (stdio + streamable HTTP `/mcp`); same tool registry (`packages/shared/src/tools.ts`), camelCase on the wire.
4. **Tools** — `search_products`, `get_offers`, `propose_order`, `get_order`, `explain` (agent); `approve_order`, `reject_order` (human-only, REST only).
5. **Signed offer** — payload = shared `Offer` (price excl./incl. VAT, VAT rate, quantity, unit, availability, cut-off, origin, labels, validity window, issuer); JWS compact, `alg ES256`, `kid` resolvable at `/.well-known/jwks.json`; payload bytes = `canonicalJson(offer)`; verifiers re-canonicalise and compare.
6. **Mandate** — shared `Mandate` (customer, agent id, validity, budget, auto-approve limit, forbidden allergens, required attributes, substitution policy, allowed categories); unsigned JSON in v0.1, buyer-signed JWS planned.
7. **Decision model** — reason codes (`REASON_CODES`) with contract severities; status derivation (`blocked` > `needs_approval` > `auto_approved`); escalation-only rule; `ALLERGEN_CONFLICT` never approvable.
8. **Order lifecycle** — `auto_approved | pending_approval → approved | rejected | blocked`; human approval via REST; `explain` returns headline, reasons, next steps, timeline.
9. **Audit chain** — `AuditEvent` with `prevHash`/`hash` (sha256 over `auditHashInput`), genesis `0…0`; buyer and Aimo views; `GET /v1/audit/verify`; SSE stream `GET /v1/audit/stream`.
10. **Identity and rate protection** — known-agent list (v0.1 static), per-agent query budget, `UNKNOWN_AGENT` / `QUERY_BUDGET_EXCEEDED`.
11. **Errors** — HTTP 400 validation, 403 unknown agent / human-only, 404, 409 not pending, 422 no orderable line (code = first reason), 429 budget; MCP tool errors carry the same `{code, message}`.
12. **Conformance (stretch)** — checklist a third-party gateway or client must satisfy; see `docs/ASSUMPTIONS.md` for what this prototype simulates.
