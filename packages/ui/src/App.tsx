import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MockGatewayApi, type GatewayApi } from './api';
import { KITCHEN } from './kitchen';
import { AuditTrail } from './screens/AuditTrail';
import { Chat } from './screens/Chat';
import { OrderDetail } from './screens/OrderDetail';
import { Orders } from './screens/Orders';
import { AllOrders, Queue } from './screens/Queue';
import { RequestForm } from './screens/RequestForm';
import { Tour, type TourStep } from './screens/Tour';
import { AURORA, Icon, useLive, type IconName } from './ui';

// label: sidebar and breadcrumb; short: the phone's bottom bar, where four full labels do not fit.
const NAV: { route: string; label: string; short: string; icon: IconName }[] = [
  { route: 'new', label: 'New order', short: 'New', icon: 'request' },
  { route: 'orders', label: 'Orders', short: 'Orders', icon: 'orders' },
  { route: 'queue', label: 'Approvals', short: 'Approvals', icon: 'approvals' },
  { route: 'audit', label: 'Audit trail', short: 'Audit', icon: 'audit' },
];
// Valio Aimo sees every buyer; the Kitchen view sees only Hotel Aurora's orders.
const AIMO_NAV: typeof NAV = [
  { route: 'all', label: 'All orders', short: 'All orders', icon: 'orders' },
  { route: 'audit', label: 'Audit trail', short: 'Audit', icon: 'audit' },
];
type View = 'kitchen' | 'aimo';
const KITCHEN_ONLY = ['new', 'orders', 'queue', 'chat'];

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, ''); // empty: the view's first screen
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase())
    .join('')
    .slice(0, 2);

export function App({ api }: { api: GatewayApi }) {
  const route = useHashRoute();
  const [narrow, setNarrow] = useState(() => {
    try {
      return localStorage.getItem('side-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleSide = () => {
    setNarrow(!narrow);
    try {
      localStorage.setItem('side-collapsed', narrow ? '0' : '1');
    } catch {
      // storage blocked: the choice just lasts until reload
    }
  };
  const [stored, setStored] = useState<View>(() => {
    try {
      return localStorage.getItem('view') === 'aimo' ? 'aimo' : 'kitchen';
    } catch {
      return 'kitchen';
    }
  });
  const keepView = (next: View) => {
    setStored(next);
    try {
      localStorage.setItem('view', next);
    } catch {
      // storage blocked: the view just lasts until reload
    }
  };
  const main = useRef<HTMLElement>(null);
  const tourButton = useRef<HTMLButtonElement>(null);
  const [touring, setTouring] = useState(() => new URLSearchParams(window.location.search).get('demo') === 'tour'); // ?demo=tour: opened by the live build's button
  const [tourAt, setTourAt] = useState<TourStep>();
  const first = useRef(true);
  const { data: orders } = useLive(api, () => api.listOrders(), 'nav-orders');
  const waiting = orders?.filter((o) => o.customerRef === AURORA && o.status === 'pending_approval').length ?? 0;

  // Move focus to the new screen on navigation, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (first.current) first.current = false;
    else if (!touring) main.current?.focus(); // the tour keeps focus in its card
  }, [route]);

  const orderId = route.startsWith('orders/') ? decodeURIComponent(route.slice('orders/'.length)) : undefined;
  const foreign = !!orderId && !!orders?.some((o) => o.orderId === orderId && o.customerRef !== AURORA);

  // A route that belongs to one view opens that view: #/all and other buyers' orders are Valio Aimo, the kitchen screens are Kitchen.
  const forced: View | undefined = route === 'all' || foreign ? 'aimo' : KITCHEN_ONLY.includes(route) ? 'kitchen' : undefined;
  const view = forced ?? stored;
  useEffect(() => {
    if (forced && forced !== stored) keepView(forced);
  }, [forced]);

  // Switching view keeps the shared screens (audit, an order Aimo may see) and otherwise opens the view's first screen.
  const pickView = (next: View) => {
    if (next === view) return;
    keepView(next);
    const keep = route === 'audit' || (orderId && (next === 'aimo' || !foreign));
    if (!keep) window.location.hash = `#/${next === 'aimo' ? 'all' : 'new'}`;
  };

  const nav = view === 'aimo' ? AIMO_NAV : NAV;
  // 'chat' is Gabri's chat ordering, kept reachable at #/chat but not in the menu (the request screen is the main flow)
  const section = orderId ? (view === 'aimo' ? 'all' : 'orders') : route === 'chat' ? 'chat' : (nav.find((item) => item.route === route)?.route ?? nav[0]!.route);
  const current = nav.find((item) => item.route === section) ?? { route: 'chat', label: 'Chat', short: 'Chat', icon: 'request' as IconName };
  const who = view === 'aimo' ? 'Valio Aimo' : KITCHEN;
  const demo = api instanceof MockGatewayApi;
  const hasBackend = !!import.meta.env.VITE_GATEWAY_URL; // a build without a backend (local mock) has nothing to switch to
  const goLive = () => window.location.assign(`${window.location.pathname}?live${window.location.hash}`);

  const tourStep = (step: TourStep) => {
    setTourAt(step);
    if (step.view) keepView(step.view);
    window.location.hash = `#/${step.route}`;
  };
  // The tour is scripted on the mock scenes: the live build's button reloads into the mock with the tour already running.
  const startTour = () => (demo ? setTouring(true) : window.location.assign(`${window.location.pathname}?demo=tour`));
  const endTour = () => {
    setTouring(false);
    setTourAt(undefined);
    if (window.location.search.includes('demo=tour')) window.history.replaceState(null, '', `${window.location.pathname}?demo${window.location.hash}`); // a reload no longer restarts it
    tourButton.current?.focus();
  };

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
      <div className={narrow ? 'shell narrow' : 'shell'}>
        <aside className="side">
          <div className="side-head">
            <p className="brand">
              <a href="/shop.html" aria-label="Back to the Valio Aimo webshop">
                <img className="brand-logo" src="/valio-aimo.svg" alt="Valio Aimo" width={96} height={32} />
              </a>
              <span className="brand-name">Mikko</span>
            </p>
            <button
              type="button"
              className="side-toggle"
              aria-label={narrow ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!narrow}
              title={narrow ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSide}
            >
              <Icon name="panel" />
            </button>
          </div>
          <nav aria-label="Main">
            <p className="nav-label">Workspace</p>
            <ul>
              {nav.map((item) => (
                <li key={item.route}>
                  <a href={`#/${item.route}`} title={narrow ? item.label : undefined} aria-current={item.route === section ? 'page' : undefined}>
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
              {api instanceof MockGatewayApi && api.liveFailed && <p>The real backend did not answer, so this is the demo.</p>}
            </div>
          )}
        </aside>

        <div className="frame">
          <header className="topbar">
            <a className="brand brand-top" href="/shop.html" aria-label="Back to the Valio Aimo webshop">
              <img className="brand-logo" src="/valio-aimo.svg" alt="Valio Aimo" width={96} height={32} />
              <span className="brand-name">Mikko</span>
            </a>
            {orderId && (
              <p className="crumbs">
                <a href={`#/${current.route}`}>{current.label}</a>
                <span aria-hidden="true">/</span>
                <span aria-current="page">Order {orderId}</span>
              </p>
            )}
            <div className="tabs view-switch" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'kitchen'} onClick={() => pickView('kitchen')}>
                Kitchen
              </button>
              <button type="button" aria-pressed={view === 'aimo'} onClick={() => pickView('aimo')}>
                <span className="view-long">Valio</span> Aimo
              </button>
            </div>
            <button ref={tourButton} type="button" className="btn tour-btn" onClick={startTour}>
              <Icon name="play" />
              <span className="tour-label">Demo tour</span>
            </button>
            <p className="who">
              <span className="avatar" aria-hidden="true">
                {initials(who)}
              </span>
              <span className="who-name">{who}</span>
            </p>
          </header>
          {demo && hasBackend && (
            <p className="demo-bar" role="status">
              <span>Demo: synthetic data, nothing is ordered for real.</span>
              <button type="button" className="btn primary" onClick={goLive}>
                Use the real product
              </button>
            </p>
          )}
          <main id="main" tabIndex={-1} ref={main}>
            {orderId ? (
              <OrderDetail api={api} orderId={orderId} />
            ) : section === 'audit' ? (
              <AuditTrail api={api} scope={view === 'aimo' ? 'aimo' : 'buyer'} />
            ) : section === 'all' ? (
              <AllOrders api={api} />
            ) : section === 'queue' ? (
              <Queue api={api} />
            ) : section === 'orders' ? (
              <Orders api={api} />
            ) : section === 'chat' ? (
              <Chat api={api} />
            ) : (
              <RequestForm key={tourAt?.title} api={api} tour={tourAt} />
            )}
          </main>
        </div>
      </div>
      {touring && <Tour onStep={tourStep} onExit={endTour} />}
    </>
  );
}
