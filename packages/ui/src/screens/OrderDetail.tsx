import type { GatewayApi } from '../api';
import { StatusBadge, time, useLive } from '../ui';
import { Cart, DecisionSummary, ReviewActions } from './OrderParts';

export function OrderDetail({ api, orderId }: { api: GatewayApi; orderId: string }) {
  const { data: order, error, refresh } = useLive(api, () => api.getOrder(orderId), orderId);

  return (
    <>
      <p>
        <a href="#/queue">Back to approval queue</a>
      </p>
      <h1>Order {orderId}</h1>
      {error && (
        <p className="error" role="alert">
          Could not load this order. {error}
        </p>
      )}
      {order && (
        <>
          <div className="card-head">
            <div>
              <p>
                <strong>{order.buyerName}</strong>
              </p>
              <p className="muted">{order.agentName ? `${order.agentName} (${order.agentId})` : order.agentId}</p>
            </div>
            <StatusBadge status={order.status} />
          </div>
          <p className="request">Request: {order.requestText}</p>

          <section aria-labelledby="cart-title">
            <h2 id="cart-title">Cart</h2>
            <Cart order={order} />
          </section>

          <section aria-labelledby="decision-title">
            <h2 id="decision-title">Decision record</h2>
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

          {order.trace && order.trace.length > 0 && (
            <section aria-labelledby="trace-title">
              <h2 id="trace-title">What the agent did</h2>
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

          <section aria-labelledby="offers-title">
            <h2 id="offers-title">Signed offers used</h2>
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
        </>
      )}
    </>
  );
}
