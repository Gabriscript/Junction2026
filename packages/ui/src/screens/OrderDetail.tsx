import type { GatewayApi } from '../api';
import { eur, Icon, StatusBadge, time, useLive } from '../ui';
import { Cart, DecisionSummary, ReviewActions } from './OrderParts';

export function OrderDetail({ api, orderId }: { api: GatewayApi; orderId: string }) {
  const { data: order, error, refresh } = useLive(api, () => api.getOrder(orderId), orderId);
  const substitutes = order?.lines.filter((l) => l.substituteFor).length ?? 0;

  return (
    <>
      <p className="back">
        <a href="#/orders">
          <Icon name="back" size={18} />
          Orders
        </a>
      </p>
      <header className="page-head page-head-row">
        <div>
          <h1>Order {orderId}</h1>
          {order && <p className="lead">{order.requestText}</p>}
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
          <section className="card detail-decision" aria-label="Decision">
            {order.approval && (
              <dl className="facts">
                <div>
                  <dt>Human review</dt>
                  <dd>
                    {order.approval.outcome === 'approved' ? 'Approved' : 'Rejected'} by {order.approval.by.name ?? order.approval.by.id},{' '}
                    {time(order.approval.at)}
                    {order.approval.comment && `. Reason: ${order.approval.comment}`}
                  </dd>
                </div>
              </dl>
            )}
            <DecisionSummary order={order} />
            <ReviewActions api={api} order={order} onDone={refresh} />
          </section>

          <section className="card detail-cart" aria-label="Cart">
            <details className="more" open={order.status === 'pending_approval'}>
              <summary>
                <span>
                  Cart: {order.lines.length} line{order.lines.length === 1 ? '' : 's'}, <span className="num">{eur(order.totals.gross)}</span> incl. VAT
                  {substitutes > 0 && ` · ${substitutes} substitute${substitutes === 1 ? '' : 's'}`}
                </span>
              </summary>
              <Cart order={order} />
            </details>
          </section>

          <section className="card detail-proof" aria-label="Proof">
            <details className="more">
              <summary>Proof</summary>
              <dl className="facts">
                <div>
                  <dt>Buyer</dt>
                  <dd>{order.buyerName}</dd>
                </div>
                <div>
                  <dt>Agent</dt>
                  <dd>{order.agentName ? `${order.agentName}, ${order.agentId}` : order.agentId}</dd>
                </div>
                <div>
                  <dt>Mandate</dt>
                  <dd>{order.mandateId}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>{time(order.createdAt)}</dd>
                </div>
              </dl>
              {order.trace && order.trace.length > 0 && (
                <>
                  <h2 className="card-title">Steps</h2>
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
                </>
              )}
              <h2 className="card-title">Signed offers</h2>
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
            </details>
          </section>
        </div>
      )}
    </>
  );
}
