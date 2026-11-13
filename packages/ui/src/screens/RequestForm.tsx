import { useState, type FormEvent } from 'react';
import type { GatewayApi } from '../api';
import type { Order } from '../contract';
import { ReasonChips, StatusBadge } from '../ui';

export function RequestForm({ api }: { api: GatewayApi }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [order, setOrder] = useState<Order>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Write what you need first.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setOrder(await api.submitRequest(text.trim()));
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>New request</h1>
      <p className="lead">Say what you need. The purchasing agent turns it into an order and the gateway decides.</p>
      <form onSubmit={submit} noValidate className="request-form">
        <label htmlFor="request-text">What do you need?</label>
        <p className="muted" id="request-hint">
          Example: 1,000 L lactose-free milk by Monday
        </p>
        <textarea
          id="request-text"
          rows={3}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={error ? 'request-hint request-error' : 'request-hint'}
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p className="error" id="request-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Sending...' : 'Send request'}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {order && (
          <section className="card" aria-label="Result">
            <div className="card-head">
              <h2>Order {order.orderId}</h2>
              <StatusBadge status={order.status} />
            </div>
            <ReasonChips codes={order.decision.reasonCodes} />
            <p>{order.decision.explanation}</p>
            <p>
              <a href={`#/orders/${order.orderId}`}>Open decision record for {order.orderId}</a>
            </p>
          </section>
        )}
      </div>
    </>
  );
}
