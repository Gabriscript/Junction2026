# Running the live demo (webshop → AI Assistant → real gateway)

Three local processes, all with real data (no mock):

| Port | What | Start |
|---|---|---|
| 8787 | **Valio Aimo gateway** (seller side: catalogue, signed offers, policy, audit) | `npm run dev -w @junction/gateway` |
| 8788 | **Assistant server** (buyer side: `planMenu` → Gabri's agent per ingredient → gateway REST) | `GATEWAY_URL=http://localhost:8787 npm run assistant -w @junction/agent` |
| 5173 | **Web app**: `shop.html` (Aimo-style webshop) + dashboard, proxies `/api` → 8788 and `/v1` → 8787 | `npm run dev:live -w packages/ui` |

Prerequisites: `.env` with `AIMO_API_KEY`, and `npm run load-catalogue` done once.

## Open it
- On the Mac / iOS Simulator: `http://localhost:5173/shop.html` → **Order with AI Assistant**.
- On a real iPhone (same Wi-Fi as the Mac): `http://<Mac Wi-Fi IP>:5173/shop.html` (`ipconfig getifaddr en0` shows the IP). `dev:live` listens on all interfaces. Then tap the text box → **Scan Text** to read the handwritten reservation.

## What happens
1. The chef's text (typed or scanned) goes to `POST /api/menu`.
2. `planMenu` turns it into dishes and a merged shopping list (recipe table with Aimo category codes, or Claude if `LLM_PROVIDER=anthropic`).
3. For each ingredient, Gabri's agent runs against the real gateway: search (narrowed by category) → signed offers → verify → pack math → `propose_order`.
4. The screen shows the plan, the assumptions, and one decision per ingredient (Ordered / Needs your approval / Blocked / Not ordered) with reason codes. Pending lines appear in **Approvals**; approving goes through the gateway and lands in the hash-chained **Audit trail**.

Demo kitchen: **Bistro Helsinki (demo)**, mandate `mdt_demo_bistro_1`, gateway demo agent `agent:demo-1`, customer `789`, auto-approve limit €80, no forced attributes (see `packages/agent/src/assistant/server.ts`).

## Real results seen (Saturday 14.11.2026 ~15:15, delivery Monday 16.11)
Reservation: *Monday dinner, 10 people, Appetizer: bruschette pomodorini mozzarella origano, Fusilli al pesto, Dessert: gelato vaniglia e cioccolato*
- 7 ordered automatically: fresh tomatoes (TOMATO NL/BE/ES), mozzarella, oregano, Barilla fusilli, parmigiano reggiano, vanilla and chocolate ice cream.
- 2 need the chef: ciabatta (`UNVERIFIED_STOCK`, `AFTER_CUTOFF`), basil pesto (`AFTER_CUTOFF`).
- One fusilli offer turned down for `PARTIAL_AVAILABILITY`.
- Results depend on the clock: `AFTER_CUTOFF` appears when the order cut-off for the delivery day has passed; "tomorrow" on a Saturday means Sunday, which Aimo does not deliver (`DELIVERY_LATER_THAN_NEEDED`), so write **Monday**.

## Clean state before recording
Stop the gateway (only the listener: `lsof -ti tcp:8787 -sTCP:LISTEN | xargs kill`), move `data/gateway.sqlite*` into `data/backup/`, start the gateway again. Orders and the audit chain start empty.

## Known limits (for Gabri)
- The agent can order fractions of a sales unit (e.g. 0.11 crate) when the product's lot size allows it; real kitchens would round up to whole packs. Worth a rule in pack math.
- Products without net-content data (e.g. grated parmesan 1 kg, Saclà pesto 950 g) can't be pack-planned, so the recipe uses categories where such data exists (parmesan blocks).
