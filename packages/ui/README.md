# @junction/ui

Approval app and audit views for the Aimo Agent Gateway (PLAN-review step 9). Vite + React + TypeScript, plain CSS, phone-first.

Screens (hash routes): `#/queue` approval queue, `#/orders/:orderId` order detail with decision record, `#/audit` audit trail (Buyer view, Aimo view), `#/request` request form.

![Approval queue at 375 px](docs/screenshot-queue.png)

## Run

```bash
npm install
npm run dev        # mock gateway, synthetic demo data
npm test
npx tsc --noEmit
npm run build
```

Real gateway: set `VITE_GATEWAY_URL` (for example `VITE_GATEWAY_URL=http://localhost:3000 npm run dev`). When it is unset the app uses `MockGatewayApi` (in memory, seeded with the three demo scenes) and shows a "Demo mode" note. The gateway must allow CORS from the UI origin.

## Expected gateway contract (assumed, not yet agreed)

Types are in `src/contract.ts`, a provisional copy to replace with `@junction/shared`. All bodies are JSON. **Money is integer euro cents** (`unitPrice`, `Alternative.total`); the UI formats it (`1 899,00 €`). `vatRate` is a fraction (`0.135`). Timestamps are ISO 8601 strings. Any non-2xx answer is shown to the user as an error.

| Method and path | Request body | Response |
|---|---|---|
| `GET /api/orders` | | `Order[]` |
| `GET /api/orders/:orderId` | | `Order` |
| `POST /api/orders/:orderId/approve` | `{ "approver": string }` | updated `Order` (`status: "approved"`) |
| `POST /api/orders/:orderId/reject` | `{ "approver": string, "reason": string }` | updated `Order` (`status: "rejected"`) |
| `GET /api/audit?scope=buyer\|aimo` | | `AuditEvent[]`, ascending `seq` |
| `POST /api/requests` | `{ "text": string }` | the resulting `Order` |
| `GET /api/events` | | SSE stream, see below |

`Order.status` is `auto_approved | needs_approval | blocked | approved | rejected`: the policy decision, then the outcome of a human review. `Order.decision.status` keeps the original policy decision. Only `needs_approval` orders can be approved or rejected.

### SSE: `GET /api/events`

`Content-Type: text/event-stream`. One unnamed message per new audit event, `data:` is one `AuditEvent` as JSON:

```
data: {"seq":13,"ts":"2026-11-14T09:00:00.000Z","actor":"human","kind":"order_approved","orderId":"ord-1002","summary":"...","details":{...},"prevHash":"...","hash":"..."}

```

The UI treats every message as "something changed" and refetches the screen it shows, so every order status change must produce an audit event. Named events (`event: ...`) are ignored.

### Audit event

```ts
{ seq: number,        // 1, 2, 3, ... no gaps
  ts: string,
  actor: string,      // agent id | "human" | "aimo"
  kind: string,       // request_received | offers_issued | order_proposed | decision | order_approved | order_rejected
  orderId?: string,
  summary: string,
  details: object,    // the Aimo view reads details.agentId, details.mandateId, details.status (on kind "decision")
  prevHash: string, hash: string }
```

`scope=buyer` returns the events of the buyer's own agents; `scope=aimo` returns all events.

## Hashing rule

The UI recomputes the chain in the browser (Web Crypto, `src/hash.ts`). The gateway must produce the same bytes:

```
hash = lowercase hex( SHA-256( UTF-8( prevHash + "\n" + canonicalJson(body) ) ) )
```

- `body` is the event **without** `hash` and `prevHash`: `seq, ts, actor, kind, orderId, summary, details`.
- `canonicalJson`: `JSON.stringify` semantics, with object keys sorted (by UTF-16 code unit, the default JS `sort()`) at every nesting level, no whitespace, `undefined` properties omitted (so a missing `orderId` is absent, not `null`). Arrays keep their order.
- `prevHash` of the event with `seq` 1 is 64 zeros. Otherwise it is the `hash` of the event with `seq - 1`.

Verification: every event's hash is recomputed; `prevHash` is compared with the previous event when that event is in the list. In the buyer view some previous events belong to other buyers and are not in the list: those links are counted and reported as "checked in the Aimo view", they do not break the indicator. The full chain is verified in the Aimo view.

## Provisional and shortcuts

- `src/contract.ts` is a local copy of the contract. `Order`, `OrderLine`, `Alternative`, `TraceStep`, `AuditEvent` are modelled by the UI.
- The approver is the fixed string `Demo approver` (no sign-in in the prototype).
- Mock `submitRequest` has no agent behind it: text containing "milk" clones the auto-approved cart, anything else clones the needs-approval cart.
- The mock buyer scope is "events made under a mandate". All mock data is synthetic, none comes from the Aimo dataset.
- "Demo: tamper with event" (audit screen, mock only) edits one stored event to show the chain breaking.
