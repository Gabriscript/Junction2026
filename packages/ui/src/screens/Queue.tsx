import { useEffect, useRef, useState } from 'react';
import type { GatewayApi } from '../api';
import type { UiOrder } from '../contract';
import { AURORA, eur, Icon, ReasonChips, StatusBadge, time, useLive } from '../ui';
import { CompactLines, SignedPriceNote } from './Compact';
import { ReviewActions } from './OrderParts';

export function Queue({ api }: { api: GatewayApi }) {
  const { data: orders, error, refresh } = useLive(api, () => api.listOrders(), 'orders');
  const [announcement, setAnnouncement] = useState('');
  const known = useRef<Set<string> | null>(null);

  const all = (orders ?? []).filter((o) => o.customerRef === AURORA);
  const pending = all.filter((o) => o.status === 'pending_approval');
  const others = all.filter((o) => o.status !== 'pending_approval').reverse();

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
      </header>
      <p className="notice" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="error" role="alert">
          Could not load orders. {error}
        </p>
      )}

      {orders && pending.length === 0 && <p className="empty card">Nothing is waiting for approval.</p>}
      {pending.map((order) => (
        <article key={order.orderId} className="card order-card compact" aria-label={`Order ${order.orderId}`} data-tour="approval">
          <div className="card-head">
            <a className="icon-btn" href={`#/orders/${order.orderId}`} aria-label="Why and proof">
              <Icon name="next" />
            </a>
          </div>
          <CompactLines order={order} />
          <ReasonChips codes={order.decision.reasonCodes} />
          <SignedPriceNote order={order} />
          <ReviewActions api={api} order={order} onDone={refresh} />
        </article>
      ))}

      <details className="card more">
        <summary>Done</summary>
        {orders && others.length === 0 && <p className="empty">No decided orders yet.</p>}
        {others.length > 0 && <OrdersTable orders={others} />}
      </details>
    </>
  );
}

/** One row per order: buyer, received, total and a status badge that opens the order. */
function OrdersTable({ orders }: { orders: UiOrder[] }) {
  return (
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
          {orders.map((order) => (
            <tr key={order.orderId} data-tour={order.status === 'blocked' ? 'blocked' : undefined}>
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
                <a className="badge-link" href={`#/orders/${order.orderId}`} aria-label={`Why order ${order.orderId} is ${order.status.replace('_', ' ')}`}>
                  {/* only Valio Aimo's table lists pending orders (the Kitchen's Done table leaves them out) */}
                  <StatusBadge status={order.status} label={order.status === 'pending_approval' ? 'Awaiting buyer' : undefined} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Valio Aimo view: every buyer's orders, blocked and unverified ones included. */
export function AllOrders({ api }: { api: GatewayApi }) {
  const { data: orders, error } = useLive(api, () => api.listOrders(), 'all-orders');
  return (
    <>
      <header className="page-head">
        <h1>All orders</h1>
      </header>
      {error && (
        <p className="error" role="alert">
          Could not load orders. {error}
        </p>
      )}
      {orders && orders.length === 0 && <p className="empty card">No orders yet.</p>}
      {orders && orders.length > 0 && (
        <section className="card">
          <OrdersTable orders={[...orders].reverse()} />
        </section>
      )}
    </>
  );
}
