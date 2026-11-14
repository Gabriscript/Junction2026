// Building blocks shared by the approval queue and the order detail.
import { useId, useState, type FormEvent } from 'react';
import type { GatewayApi } from '../api';
import { UNIT_CODE_NAMES, type Actor } from '@junction/shared';
import type { UiOrder } from '../contract';
import { eur, ReasonChips, substituteReasons, vatPercent, whyText } from '../ui';

// shortcut: no sign-in in the prototype, add the real approver identity with auth
export const APPROVER: Actor = { type: 'human', id: 'user:demo.approver', name: 'Demo approver' };

export function Cart({ order }: { order: UiOrder }) {
  const { totals } = order;
  const reasons = substituteReasons(order);
  return (
    <div className="cart">
      <ul className="lines" aria-label="Cart lines">
        {order.lines.map((line) => {
          const unverified = order.decision.reasons.some((r) => r.code === 'UNVERIFIED_STOCK' && r.lineId === line.lineId);
          const unitName = UNIT_CODE_NAMES[line.unit];
          return (
            <li key={line.lineId}>
              <div className="line-main">
                <span className="line-name">{line.productName}</span>
                <span className="num">{eur(line.totals.net)}</span>
              </div>
              <p className="muted">
                {line.quantity} × {line.unit}
                {unitName && ` (${unitName})`} at {eur(line.unitPrice)} each
              </p>
              <p className="muted">
                VAT {vatPercent(line.vatRate)}: {eur(line.totals.vat)}
                {', '}
                {unverified ? 'terminal stock, quantity not verified' : 'stock verified'}
              </p>
              {line.substituteFor && (
                <p className="substitute">
                  <strong>Substitute for {order.lines.find((l) => l.productId === line.substituteFor)?.productName ?? `product ${line.substituteFor}`}.</strong>{' '}
                  {reasons.get(line.lineId)?.replace(/^./, (c) => c.toUpperCase())}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <dl className="totals">
        <div>
          <dt>Subtotal excl. VAT</dt>
          <dd className="num">{eur(totals.net)}</dd>
        </div>
        <div>
          <dt>VAT</dt>
          <dd className="num">{eur(totals.vat)}</dd>
        </div>
        <div className="grand">
          <dt>Total incl. VAT</dt>
          <dd className="num">{eur(totals.gross)}</dd>
        </div>
      </dl>
    </div>
  );
}

const TIER_LABEL = { good: 'Good', better: 'Better', best: 'Best' } as const;

/** Reasons and the agent's why; `withAlternatives` false when the caller shows them elsewhere. */
export function DecisionSummary({ order, withAlternatives = true }: { order: UiOrder; withAlternatives?: boolean }) {
  return (
    <>
      <ReasonChips codes={order.decision.reasonCodes} />
      <details className="more">
        <summary>Why the agent chose this</summary>
        {whyText(order).map((text, i) => (
          <p key={i} className="why">
            {text}
          </p>
        ))}
      </details>
      {withAlternatives && <Alternatives order={order} />}
    </>
  );
}

export function Alternatives({ order, wide = false }: { order: UiOrder; wide?: boolean }) {
  return (
    <>
      {order.alternatives && order.alternatives.length > 0 && (
        <details className="more">
          <summary>Other options ({order.alternatives.length})</summary>
          <ul className={wide ? 'alternatives alt-grid' : 'alternatives'}>
            {order.alternatives.map((alt) => (
              <li key={alt.tier} className={alt.chosen ? 'chosen' : undefined}>
                <div className="line-main">
                  <span>
                    <strong>{TIER_LABEL[alt.tier]}:</strong> {alt.title}
                  </span>
                  <span className="num">{eur(alt.total)}</span>
                </div>
                <p className="muted">
                  {alt.chosen && <strong>In the cart. </strong>}
                  {alt.why}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function ReviewActions({ api, order, onDone }: { api: GatewayApi; order: UiOrder; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fieldId = useId();

  if (order.status !== 'pending_approval') return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const submitReject = (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Write a short reason before rejecting.');
      return;
    }
    void run(() => api.reject(order.orderId, APPROVER, reason.trim()));
  };

  return (
    <div className="actions">
      {rejecting ? (
        <form onSubmit={submitReject} noValidate>
          <label htmlFor={fieldId}>Reason for rejecting {order.orderId}</label>
          <input
            id={fieldId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            autoFocus
            aria-describedby={error ? `${fieldId}-error` : undefined}
            aria-invalid={error ? true : undefined}
          />
          {error && (
            <p className="error" id={`${fieldId}-error`} role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button type="submit" className="btn danger" disabled={busy}>
              Confirm rejection
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setRejecting(false); setError(undefined); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              aria-label={`Approve order ${order.orderId}`}
              onClick={() => void run(() => api.approve(order.orderId, APPROVER))}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-label={`Reject order ${order.orderId}`}
              onClick={() => { setRejecting(true); setError(undefined); }}
            >
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
}
