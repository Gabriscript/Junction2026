import type { GatewayApi } from '../api';
import { Icon, StatusBadge, time, useLive } from '../ui';
import { Cart, DecisionSummary, ReviewActions } from './OrderParts';

export function OrderDetail({ api, orderId }: { api: GatewayApi; orderId: string }) {
  const { data: order, error, refresh } = useLive(api, () => api.getOrder(orderId), orderId);

  return (
    <>
      <p className="back">
        <a href="#/orders">
          <Icon name="back" size={18} />
          Back to orders
        </a>
      </p>
      <header className="page-head page-head-row">
        <div>
          <h1>Order {orderId}</h1>
          {order && (
            <>
              <p className="lead">{order.buyerName}</p>
              <p className="muted">
                {order.agentName ? `${order.agentName}, ${order.agentId}` : order.agentId}
              </p>
            </>
          )}
        </div>
        {order && <StatusBadge status={order.status} />}
      </header>
      {error && (
        <p className="error" role="alert">
          Could not load this order. {error}
        </p>
      )}
      {order && (
        <div className="detail-grid">
          <section className="card detail-decision" aria-labelledby="decision-title">
            <h2 id="decision-title" className="card-title">
              Decision
            </h2>
            <dl className="facts">
              <div>
                <dt>Gateway decision</dt>
                <dd>
                  <StatusBadge status={order.decision.status} />
                </dd>
              </div>
              <div>
                <dt>Mandate</dt>
                <dd>{order.mandateId}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{time(order.createdAt)}</dd>
              </div>
              {order.approval && (
                <div>
                  <dt>Human review</dt>
                  <dd>
                    {order.approval.outcome === 'approved' ? 'Approved' : 'Rejected'} by {order.approval.by.name ?? order.approval.by.id},{' '}
                    {time(order.approval.at)}
                    {order.approval.comment && `. Reason: ${order.approval.comment}`}
                  </dd>
                </div>
              )}
            </dl>
            <DecisionSummary order={order} />
            <ReviewActions api={api} order={order} onDone={refresh} />
          </section>

          <section className="card detail-cart" aria-labelledby="cart-title">
            <h2 id="cart-title" className="card-title">
              Cart
            </h2>
            <p className="request">
              <span className="muted">Request</span> {order.requestText}
            </p>
            <Cart order={order} />
          </section>

          {order.trace && order.trace.length > 0 && (
            <section className="card detail-trace" aria-labelledby="trace-title">
              <h2 id="trace-title" className="card-title">
                Steps
              </h2>
              <ol className="trace">
                {order.trace.map((step, i) => (
                  <li key={i}>
                    <p>{step.text}</p>
                    <p className="muted">
                      {time(step.at)}
                      {step.tool && (
                        <>
                          , tool <code>{step.tool}</code>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="card detail-offers" aria-labelledby="offers-title">
            <h2 id="offers-title" className="card-title">
              Signed offers
            </h2>
            <ul className="rows">
              {order.lines.map((line) => (
                <li key={line.lineId}>
                  <p>
                    <code>{line.offerId}</code> {line.productName}
                  </p>
                  <p className="muted">
                    {line.offerVerified ? 'Signature verified' : 'Signature not verified'}, available{' '}
                    {line.availableDate ?? 'not deliverable'}
                    {line.substituteFor && `, substitute for ${line.substituteFor}`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
