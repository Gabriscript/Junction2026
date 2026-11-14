# Submission video (max 2:00) — storyboard and data check

Status: **proposal**, 2026-11-14. Based on Claudio's idea (reservation → chef → AI Assistant on the phone), adjusted so the video also scores on *Autonomy & controls* (20 %) and *Openness* (15 %), not only on the chef experience.

## Key message
**The agent does the work; the chef steps in only when it matters.** Routine lines are ordered automatically inside the mandate with Aimo-signed offers; only exceptions reach the chef's phone.

## Storyboard (≈ 2:00)
| Time | Scene | What it proves |
|---|---|---|
| 0:00–0:12 | Reception hands the chef a reservation: *tomorrow dinner, 10 people — bruschette pomodorini mozzarella origano, fusilli al pesto, gelato vaniglia e cioccolato* | Real user need |
| 0:12–0:30 | Phone (iPhone simulator beside the screen): Aimo order page → **AI Assistant** → chef types or pastes the reservation (scan only if built, see below) → send | Request |
| 0:30–0:50 | **Plan**: 3 dishes → shopping list with quantities (`planMenu`), assumptions visible ("ready-made pesto", "delivery tomorrow") | Least manual correction |
| 0:50–1:15 | **Decisions**: ✅ most lines auto-ordered (signed offers verified, within budget); cheaper fusilli brand chosen automatically (same product, within rules, logged); 🟡 one exception needs the chef (reason code) → tap **Approve** → back to cooking | Guardrails, exceptions |
| 1:15–1:40 | Laptop, **Valio Aimo view**: audit trail, "signature verified", reason codes; 5 s of a rogue/tampered order **blocked** | Trust, auditability |
| 1:40–2:00 | Close: *Any AI agent, one open interface (MCP + OpenAPI), signed offers, humans only when it matters.* Team name | Openness |

## Catalogue check (synthetic data, 2026-11-14)
All menu products exist in the catalogue:
- bread: ciabatta / baguette (frozen, part-baked) ✅
- tomatoes: fresh "FAVORINO TOMATO FIN", "PEARL TOMATO" (category 17401); "cherry tomato" only matches semi-dried ones → search "tomato" ✅
- mozzarella 125 g balls (several, incl. lactose-free) ✅ · oregano ✅ · olive oil ✅
- fusilli: Barilla 5 kg, De Cecco 500 g, gluten-free 500 g → **real cheaper-brand choice** ✅
- pesto: Saclà 950 g Genovese, Knorr paste 340 g ✅ · parmesan ✅
- ice cream 5 L tubs: vanilla (16), chocolate (18), strawberry (11) ✅

Live availability for delivery 2026-11-16 (one read-only call, 14 products):
- **Vanilla ice cream is available** (e.g. 36 and 85 tubs) → "vanilla sold out → strawberry" does **not** happen with real data. Options: (a) simulate a stock-out in a demo scenario and list it in ASSUMPTIONS.md; (b) use a **real** exception instead (below).
- **"FAVORINO TOMATO FIN" returns no delivery line** (not deliverable) → a **real** exception: the agent proposes another fresh tomato. Honest and in the data.
- Several products are Terminal stock (999999, quantity not verified) → real `UNVERIFIED_STOCK` reason codes.

Recommendation: use the real exceptions (tomato not deliverable, unverified stock); if we keep the vanilla story, make it an explicit simulated scenario.

## Risks before recording
- **Scanner (photo → text)**: not built. ~2–3 h with Claude vision. Build only after the end-to-end flow works; otherwise type/paste. **Do not fake it.**
- **2:00 is strict.** Rehearse with a timer.
- The final video must show the real system (no mocked screens).
