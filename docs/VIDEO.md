# Submission video (max 2:00) — storyboard and data check

Status: **proposal**, 2026-11-14. Based on Claudio's idea (reservation → chef → AI Assistant on the phone), adjusted so the video also scores on *Autonomy & controls* (20 %) and *Openness* (15 %), not only on the chef experience.

## Key message
**The agent does the work; the chef steps in only when it matters.** Routine lines are ordered automatically inside the mandate with Aimo-signed offers; only exceptions reach the chef's phone.

## Storyboard (≈ 2:00)
| Time | Scene | What it proves |
|---|---|---|
| 0:00–0:12 | Reception hands the chef a reservation: *tomorrow dinner, 10 people — bruschette pomodorini mozzarella origano, fusilli al pesto, gelato vaniglia e cioccolato* | Real user need |
| 0:12–0:30 | Phone: Aimo order page → **AI Assistant** → chef taps the text box → iPhone **Scan Text** (built-in Live Text, camera) reads the reservation into the box → chef checks → send | Request |
| 0:30–0:50 | **Plan**: 3 dishes → shopping list with quantities (`planMenu`), assumptions visible ("ready-made pesto", "delivery tomorrow") | Least manual correction |
| 0:50–1:20 | **Decisions**: ✅ most lines auto-ordered (signed offers verified, within budget); fusilli: the agent picks the option that fits the rules and logs why; 🟡 real exceptions reach the chef with a reason code (pomodorini not deliverable → regular tomatoes) → tap **Approve** → back to cooking | Guardrails, exceptions |
| 1:20–2:00 | Laptop, **Valio Aimo view**: audit trail, "signature verified", reason codes; 5 s of a rogue/tampered order **blocked**; end on the team name | Trust, auditability |

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

### Second check: every menu line, delivery 2026-11-16 (read-only, 22 products + 9 prices)
| Menu line | Deliverable | Not deliverable (real exceptions) |
|---|---|---|
| bread | Ciabatta 20×250 g (72), ¼ ciabatta pre-baked (27) | — |
| pomodorini | only plain "TOMATO NL/BE/ES" (unverified qty) | **Pearl tomato, San Marzano, Favorino** → *pomodorini not available → regular tomatoes* |
| mozzarella | 125 g balls: lactose-free (11 603), Pasta Filata (3 710), bufala (646) | — |
| oregano / basil | Santa Maria oregano (48), basil bunch (565) | — |
| olive oil | (none of the 2 checked) | **MONUM 500 ml and 1 L** → needs another oil or drop it |
| fusilli | Barilla 5 kg, €18.14 = €3.63/kg (57) | **De Cecco 500 g** (€5.36/kg) |
| pesto | Knorr paste 340 g €12.42 (37); Saclà 950 g €59.66 (unverified qty) | — |
| parmesan | grated 1 kg (406) | — |
| vanilla ice cream | Suomen Jäätelö 5 L €39.67 (36), GelatoLAB lactose-free €22.38 (85), Amigo (1 489) | — |
| chocolate ice cream | Suomen Jäätelö 5 L €47.20 (9), GelatoLAB €26.85 (38) | **Amigo chocolate** |

What this gives the demo with **real data only**:
- Substitution: pomodorini → regular tomatoes (needs chef: different product).
- Pack trade-off: fusilli only in a 5 kg bag (we need 1 kg) → cheapest per kg but 4 kg left over; the agent shows the rounding.
- Unverified stock: Saclà pesto, tomatoes → `UNVERIFIED_STOCK`.
- Vanilla is available: a "sold out" scene must be a **declared simulated scenario** (demo switch in the gateway, listed in ASSUMPTIONS.md), never only a caption in the video.

## Recipes: where they come from
- Today: an LLM (Claude Haiku) proposes ingredients for **any** dish (`anthropicSuggester`, needs `LLM_PROVIDER=anthropic` + key); the fixed table is the offline fallback.
- Next step (slide): use Valio Aimo's own professional recipes as a trusted source, so suggestions map straight to Aimo products.

## Risks before recording
- **Scanner**: no code needed — iOS **Live Text / Scan Text** fills any text box from the camera. It needs a **real iPhone camera**: the iOS Simulator has no camera, so film that moment on a real phone (screen recording) and say it is the phone's built-in feature.
- **2:00 is strict.** Rehearse with a timer.
- The final video must show the real system (no mocked screens).
