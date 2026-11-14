import { useEffect, useRef, useState } from 'react';
import type { GatewayApi } from '../api';
import type { UiOrder } from '../contract';
import { eur, Icon, ReasonChips, StatusBadge, time, useLive } from '../ui';
import { CompactLines, SignedPriceNote } from './Compact';
import { ReviewActions } from './OrderParts';

/** Gross EUR, summed in integer cents. */
const grossOf = (orders: UiOrder[]) => orders.reduce((sum, o) => sum + Math.round(o.totals.gross * 100), 0) / 100;
const count = (orders: UiOrder[], status: UiOrder['status']) => orders.filter((o) => o.status === status).length;

export function Queue({ api }: { api: GatewayApi }) {
  const { data: orders, error, refresh } = useLive(api, () => api.listOrders(), 'orders');
  const [announcement, setAnnouncement] = useState('');
  const known = useRef<Set<string> | null>(null);

  const all = orders ?? [];
  const pending = all.filter((o) => o.status === 'pending_approval');
  const others = all.filter((o) => o.status !== 'pending_approval').reverse();
  const placed = count(all, 'auto_approved') + count(all, 'approved');
  const stopped = count(all, 'blocked') + count(all, 'rejected');

  // Announce orders that start waiting after the first load.
  useEffect(() => {
    if (!orders) return;
    const ids = new Set(pending.map((o) => o.orderId));
    if (known.current) {
      const fresh = pending.filter((o) => !known.current!.has(o.orderId));
      if (fresh.length > 0) {
        setAnnouncement(`New order needs approval: ${fresh.map((o) => `${o.orderId} from ${o.buyerName}`).join(', ')}.`);
      }
    }
    known.current = ids;
  }, [orders]);

  return (
    <>
      <header className="page-head">
        <h1>Approvals</h1>
        <p className="lead">The agent paused these orders. You decide.</p>
      </header>
      <p className="notice" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="error" role="alert">
          Could not load orders. {error}
        </p>
      )}

      {orders && (
        <section className="stats" aria-label="Summary">
          <div className="stat stat-main">
            <p className="stat-title">
              <span className="tile">
                <Icon name="clock" />
              </span>
              <strong>Needs your OK</strong>
            </p>
            <p className="stat-value">{pending.length}</p>
            <p className="stat-foot">
              <span className="num">{eur(grossOf(pending))}</span> on hold
            </p>
          </div>
          <div className="stat">
            <p className="stat-title">
              <span className="tile">
                <Icon name="placed" />
              </span>
              <strong>Ordered</strong>
            </p>
            <p className="stat-value">{placed}</p>
            <p className="stat-foot">
              {count(all, 'auto_approved')} automatic, {count(all, 'approved')} approved by you
            </p>
          </div>
          <div className="stat">
            <p className="stat-title">
              <span className="tile">
                <Icon name="stopped" />
              </span>
              <strong>Not ordered</strong>
            </p>
            <p className="stat-value">{stopped}</p>
            <p className="stat-foot">
              {count(all, 'blocked')} blocked, {count(all, 'rejected')} rejected by you
            </p>
          </div>
        </section>
      )}
      <details className="more">
        <summary>What is the difference?</summary>
        <dl className="meanings">
          <div>
            <dt>Needs your OK</dt>
            <dd>Something is unusual, so the agent waits. You approve or reject.</dd>
          </div>
          <div>
            <dt>Ordered</dt>
            <dd>Sent to Valio Aimo, automatically or after your OK.</dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>The gateway refused it, for example a changed price. Nobody can approve it.</dd>
          </div>
        </dl>
      </details>

      <section aria-labelledby="pending-title">
        <h2 id="pending-title" className="section-title">
          Needs your OK ({pending.length})
        </h2>
        {orders && pending.length === 0 && <p className="empty card">Nothing is waiting for approval.</p>}
        {pending.map((order) => (
          <article key={order.orderId} className="card order-card compact" aria-labelledby={`title-${order.orderId}`}>
            <header className="card-head">
              <h3 id={`title-${order.orderId}`}>{order.buyerName}</h3>
              <StatusBadge status={order.status} />
            </header>
            <CompactLines order={order} />
            <ReasonChips codes={order.decision.reasonCodes} />
            <SignedPriceNote order={order} />
            <ReviewActions api={api} order={order} onDone={refresh} />
            <p className="muted">
              <a href={`#/orders/${order.orderId}`}>Details and why the agent chose this</a>
            </p>
          </article>
        ))}
      </section>

      <section className="card" aria-labelledby="others-title">
        <h2 id="others-title" className="card-title">
          Done
        </h2>
        {orders && others.length === 0 && <p className="empty">No decided orders yet.</p>}
        {others.length > 0 && (
          <div className="table-wrap">
            <table className="orders">
              <thead>
                <tr>
                  <th scope="col">Buyer</th>
                  <th scope="col" className="hide-sm">
                    Received
                  </th>
                  <th scope="col" className="hide-sm num-col">
                    Total incl. VAT
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {others.map((order) => (
                  <tr key={order.orderId}>
                    <th scope="row">
                      <a href={`#/orders/${order.orderId}`}>{order.buyerName}</a>
                      <span className="muted">
                        {order.orderId}
                        <span className="show-sm">, {eur(order.totals.gross)}</span>
                      </span>
                    </th>
                    <td className="hide-sm muted">{time(order.createdAt)}</td>
                    <td className="hide-sm num num-col">{eur(order.totals.gross)}</td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
