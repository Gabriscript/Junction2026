import { useEffect, useRef, useState } from 'react';
import { MockGatewayApi, type GatewayApi } from './api';
import { AuditTrail } from './screens/AuditTrail';
import { OrderDetail } from './screens/OrderDetail';
import { Queue } from './screens/Queue';
import { RequestForm } from './screens/RequestForm';

const NAV = [
  { href: '#/queue', label: 'Approvals' },
  { href: '#/audit', label: 'Audit trail' },
  { href: '#/request', label: 'New request' },
];

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '') || 'queue';
}

export function App({ api }: { api: GatewayApi }) {
  const route = useHashRoute();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Move focus to the new screen on navigation, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (first.current) first.current = false;
    else main.current?.focus();
  }, [route]);

  const orderId = route.startsWith('orders/') ? decodeURIComponent(route.slice('orders/'.length)) : undefined;
  const section = orderId ? 'queue' : route;

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="wrap">
          <p className="brand">Trusted Trade Agents</p>
          <nav aria-label="Main">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} aria-current={item.href === `#/${section}` ? 'page' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="wrap" tabIndex={-1} ref={main}>
        {api instanceof MockGatewayApi && (
          <p className="muted demo-note">Demo mode: mock gateway with synthetic data.</p>
        )}
        {orderId ? (
          <OrderDetail api={api} orderId={orderId} />
        ) : route === 'audit' ? (
          <AuditTrail api={api} />
        ) : route === 'request' ? (
          <RequestForm api={api} />
        ) : (
          <Queue api={api} />
        )}
      </main>
    </>
  );
}
