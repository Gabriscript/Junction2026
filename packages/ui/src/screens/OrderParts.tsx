// Building blocks shared by the approval queue and the order detail.
import { useId, useState, type FormEvent } from 'react';
import type { GatewayApi } from '../api';
import type { Order } from '../contract';
import { eur, orderTotals, ReasonChips } from '../ui';

export const APPROVER = 'Demo approver'; // shortcut: no sign-in in the prototype, add the real approver identity with auth

export function Cart({ order }: { order: Order }) {
  const totals = orderTotals(order);
  return (
    <div className="cart">
      <ul className="lines" aria-label="Cart lines">
        {order.lines.map(({ signedOffer: { offer }, quantity, packLabel }) => {
          const net = quantity * offer.unitPrice;
          return (
            <li key={offer.offerId}>
              <div className="line-main">
                <span className="line-name">{offer.productName}</span>
                <span className="num">{eur(net)}</span>
              </div>
              <p className="muted">
                {quantity} × {offer.unit} ({packLabel}) at {eur(offer.unitPrice)} each
              </p>
              <p className="muted">
                VAT {(offer.vatRate * 100).toLocaleString('fi-FI')} %: {eur(Math.round(net * offer.vatRate))}
                {', '}
                {offer.quantityVerified ? 'stock verified' : 'terminal stock, quantity not verified'}
              </p>
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

export function DecisionSummary({ order }: { order: Order }) {
  return (
    <>
      <ReasonChips codes={order.decision.reasonCodes} />
      <h4>Why</h4>
      <p>{order.decision.explanation}</p>
      {order.alternatives.length > 0 && (
        <>
          <h4>Alternatives considered</h4>
          <ul className="alternatives">
            {order.alternatives.map((alt) => (
              <li key={alt.tier}>
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
        </>
      )}
    </>
  );
}

export function ReviewActions({ api, order, onDone }: { api: GatewayApi; order: Order; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fieldId = useId();

  if (order.status !== 'needs_approval') return null;

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
