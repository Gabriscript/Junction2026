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
                <strong>{order.buyer}</strong>
              </p>
              <p className="muted">
                {order.agentName} ({order.agentId})
              </p>
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
                <dd>{order.mandateId ?? 'No valid mandate presented'}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{time(order.createdAt)}</dd>
              </div>
              {order.review && (
                <div>
                  <dt>Human review</dt>
                  <dd>
                    {order.review.action === 'approved' ? 'Approved' : 'Rejected'} by {order.review.approver}, {time(order.review.at)}
                    {order.review.reason && `. Reason: ${order.review.reason}`}
                  </dd>
                </div>
              )}
            </dl>
            <DecisionSummary order={order} />
            <ReviewActions api={api} order={order} onDone={refresh} />
          </section>

          <section aria-labelledby="trace-title">
            <h2 id="trace-title">What the agent did</h2>
            <ol className="trace">
              {order.trace.map((step, i) => (
                <li key={i}>
                  <p>{step.text}</p>
                  <p className="muted">
                    {time(step.ts)}
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

          <section aria-labelledby="offers-title">
            <h2 id="offers-title">Signed offers used</h2>
            <ul className="rows">
              {order.lines.map(({ signedOffer: { offer } }) => (
                <li key={offer.offerId}>
                  <p>
                    <code>{offer.offerId}</code> {offer.productName}
                  </p>
                  <p className="muted">
                    Issued by {offer.issuer}, valid until {time(offer.validUntil)}, available {offer.availableDate}
                    {offer.origin && `, origin ${offer.origin}`}
                    {offer.labels.length > 0 && `, ${offer.labels.join(', ')}`}
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
