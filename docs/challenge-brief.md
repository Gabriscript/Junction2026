# Challenge brief — Valio Aimo "Trusted Trade Agents" (Junction 2026)

Condensed from the official challenge text and the printed one-pager. Secrets (portal password, API key, webshop credentials) are intentionally **not** stored here; get them from the Junction platform and put them in `.env`.

## The question
> How can a food-service wholesaler let autonomous purchasing agents place an order – finding products, comparing offers and getting the right approval in a fraction of the time it takes today – without exposing real systems, confidential data or the marketplace roadmap?

Valio Aimo: 20,000+ professional kitchens, 25,000 products, 700 suppliers. They plan a future B2B marketplace, but **for Junction we mock today's webshop/backend, not the marketplace**. Goal: prototype the **interface and operating model** through which an external purchasing agent interacts with Aimo's systems, on **open, verifiable standards** rather than someone else's black box.

## Flow the solution must run
1. **Request** — agent asks for what the buyer needs
2. **Lookup** — find products, prices, availability
3. **Order** — commit at a fixed price (no negotiation)
4. **Approval** — agent decides, or a human signs off

Example: a hotel chain's agent asks *"I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability."*

## Core (must build)
- Product, price & availability lookup — structured search and retrieval
- Request → order — inquiry to commitment at **fixed prices**
- Permissions & human approval — what the agent decides alone vs. what a human signs off

## Optional (not required to win)
- Delivery reliability & sustainability labels comparison (category CO₂ ranges = stretch)
- Substitution / exception handling (failed deliveries were last year's challenge — not core)
- Traceability & explainability — human-readable record of what the agent did and why

## Insight section — what they'd love to see
- **Trust protocol:** minimum data/verification standard for an agent to trust Aimo's claims on stock, price and origin without a manual check
- **Guardrails model:** which decisions need human sign-off (spend threshold, substitutions outside stated preferences) vs. fully autonomous
- **Response logic:** partial availability and substitution ranking ("good-better-best") within Aimo's assortment
- **Audit trail:** usable, human-readable log for **both buyer and Valio Aimo**

Example scenarios: need→recipe→order; last-minute event; supplier stock-out; proactive selling agent; allergen-safe substitution (school/hospital); standing-order drift detection.

## Judging
| Criterion | Weight | What it means (official) |
|---|---|---|
| Working end-to-end demo | 30% | Runs a full request → lookup → order/approval flow in the mocked environment, not just isolated pieces |
| Solving the problem and user need | 20% | How precisely the agent matches what the buyer actually asked for, with the least manual correction needed |
| Autonomy and controls | 20% | Quality of the guardrails design: what the agent decides alone, what needs human sign-off, how decisions are logged and auditable |
| Robustness to exception situations | 15% | Partial availability, substitutions and delivery constraints beyond the happy path |
| Openness and credible path toward production | 15% | Open, documented standards rather than a proprietary format, clear visibility of assumptions, well-justified technical choices, credible view of next development steps |

"Trust and openness by design: a full flow that works, a clear model for human sign-off, and open, well-documented choices. **Not** a production-ready system in 48 hours."

## Good to know
- It is **not a chatbot**.
- Query the APIs **only when needed, never for all products**.
- Scope note: whether production becomes REST, MCP-style or a service agent is out of scope.
- Preferred tech: agentic/tool-use frameworks, open interop standards, recommendation logic, optional verifiable credentials / trust layer. Agentic payments (x402, Nevermined) relevant context, not required.
- Prizes: 1st €4,000 · 2nd €2,000 · 3rd €1,000

## Mentors
- Marketplace/Commercial: Hanna Forsström, Pirjo Kaartinen
- Online Sales: Minni Ruhtinas
- IT/Tech integrations & Data governance: Tommi Nurmi-Aro, Ville Takanen, Riku Tapper

## Resources
- Resource portal: https://junction26.valioaimo.fi/ (password on Junction platform) — full digest in [portal-notes.md](portal-notes.md)
- Webshop (reference only): https://toimitustukku.valioaimo.fi
