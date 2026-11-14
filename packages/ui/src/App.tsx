import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MockGatewayApi, type GatewayApi } from './api';
import { KITCHEN } from './kitchen';
import { AuditTrail } from './screens/AuditTrail';
import { Chat } from './screens/Chat';
import { OrderDetail } from './screens/OrderDetail';
import { Orders } from './screens/Orders';
import { Queue } from './screens/Queue';
import { Icon, useLive, type IconName } from './ui';

// label: sidebar and breadcrumb; short: the phone's bottom bar, where four full labels do not fit.
const NAV: { route: string; label: string; short: string; icon: IconName }[] = [
  { route: 'new', label: 'New order', short: 'New', icon: 'request' },
  { route: 'orders', label: 'Orders', short: 'Orders', icon: 'orders' },
  { route: 'queue', label: 'Approvals', short: 'Approvals', icon: 'approvals' },
  { route: 'audit', label: 'Audit trail', short: 'Audit', icon: 'audit' },
];

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '') || 'new';
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase())
    .join('')
    .slice(0, 2);

export function App({ api }: { api: GatewayApi }) {
  const route = useHashRoute();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  const { data: orders } = useLive(api, () => api.listOrders(), 'nav-orders');
  const waiting = orders?.filter((o) => o.status === 'pending_approval').length ?? 0;

  // Move focus to the new screen on navigation, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (first.current) first.current = false;
    else main.current?.focus();
  }, [route]);

  const orderId = route.startsWith('orders/') ? decodeURIComponent(route.slice('orders/'.length)) : undefined;
  const section = orderId ? 'orders' : (NAV.find((item) => item.route === route)?.route ?? 'new');
  const current = NAV.find((item) => item.route === section)!;
  const demo = api instanceof MockGatewayApi;

  // The router owns the hash, so the skip link moves focus instead of navigating to "#main".
  const skip = (e: MouseEvent) => {
    e.preventDefault();
    main.current?.focus();
  };

  return (
    <>
      <a className="skip" href="#main" onClick={skip}>
        Skip to content
      </a>
      <div className="shell">
        <aside className="side">
          <p className="brand">
            <span className="brand-mark">
              <Icon name="shield" />
            </span>
            Trusted Trade
          </p>
          <nav aria-label="Main">
            <p className="nav-label">Workspace</p>
            <ul>
              {NAV.map((item) => (
                <li key={item.route}>
                  <a href={`#/${item.route}`} aria-current={item.route === section ? 'page' : undefined}>
                    <Icon name={item.icon} />
                    <span className="nav-long">{item.label}</span>
                    <span className="nav-short">{item.short}</span>
                    {item.route === 'queue' && waiting > 0 && (
                      <span className="count">
                        {waiting}
                        <span className="visually-hidden"> waiting</span>
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {demo && (
            <div className="side-note">
              <strong>Demo mode</strong>
              <p>Mock gateway with synthetic data. Nothing is ordered for real.</p>
            </div>
          )}
        </aside>

        <div className="frame">
          <header className="topbar">
            <p className="brand brand-top">
              <span className="brand-mark">
                <Icon name="shield" />
              </span>
              Trusted Trade
            </p>
            <p className="crumbs">
              {orderId ? (
                <>
                  <a href="#/orders">{current.label}</a>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">Order {orderId}</span>
                </>
              ) : (
                <>
                  <span>Trusted Trade</span>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">{current.label}</span>
                </>
              )}
            </p>
            <p className="who">
              <span className="avatar" aria-hidden="true">
                {initials(KITCHEN)}
              </span>
              <span className="who-name">{KITCHEN}</span>
            </p>
          </header>
          <main id="main" tabIndex={-1} ref={main}>
            {demo && <p className="demo-note">Demo mode: mock gateway with synthetic data.</p>}
            {orderId ? (
              <OrderDetail api={api} orderId={orderId} />
            ) : section === 'audit' ? (
              <AuditTrail api={api} />
            ) : section === 'queue' ? (
              <Queue api={api} />
            ) : section === 'orders' ? (
              <Orders api={api} />
            ) : (
              <Chat api={api} />
            )}
          </main>
        </div>
      </div>
    </>
  );
}
