import { useEffect, useState, type FormEvent } from 'react';
import type { ReasonCode } from '@junction/shared';
import { MockGatewayApi, type GatewayApi } from '../api';
import type { MenuResult, UiOrder } from '../contract';
import { UNIT_CODE_NAMES } from '@junction/shared';
import { history, parLevels, parseMessage, reviewWeek } from '../kitchen';
import { eur, firstSentence, ReasonChips, StatusBadge, substituteReasons, WhyText } from '../ui';
import { ProductPhoto } from './Compact';
import { CaptureBar } from './Capture';
import type { TourStep } from './Tour';

const LINE_STATUS: Record<MenuResult['lines'][number]['status'], { label: string; tone: 'ok' | 'warn' | 'stop' }> = {
  auto_approved: { label: 'Ordered', tone: 'ok' },
  needs_approval: { label: 'Needs your OK', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'stop' },
  not_ordered: { label: 'Not ordered', tone: 'stop' },
};

const packsText = (n: number, unit?: string) =>
  `${n.toLocaleString('fi-FI', { maximumFractionDigits: 2 })} ${(unit && UNIT_CODE_NAMES[unit as keyof typeof UNIT_CODE_NAMES]) ?? unit ?? ''}`.trim();

/** What Valio Aimo will deliver from this request: ordered lines with photo, packs × signed price and total. */
function WhatWasOrdered({ lines }: { lines: MenuResult['lines'] }) {
  const ordered = lines.filter((l) => l.status === 'auto_approved' && l.grossEur !== undefined);
  if (ordered.length === 0) return null;
  const sum = (ls: typeof lines) => ls.reduce((n, l) => n + (l.grossEur ?? 0), 0);
  const row = (l: MenuResult['lines'][number]) => (
    <li key={`${l.orderId}-${l.name}`} className="compact-line">
      <ProductPhoto productId={l.productId} name={l.product ?? l.name} />
      <div className="compact-text">
        <strong>{l.product}</strong>
        <span className="muted">
          {packsText(l.packs ?? 0, l.salesUnit)} × {eur(l.unitPriceEur ?? 0)} · for {l.name}
        </span>
      </div>
      <span className="compact-price">{eur(l.grossEur ?? 0)}</span>
    </li>
  );
  return (
    <section className="card" aria-labelledby="ordered-h">
      <h2 id="ordered-h">What was ordered</h2>
      <ul className="compact-lines">{ordered.map(row)}</ul>
      <p className="ordered-total">
        <span>Ordered, incl. VAT</span> <strong>{eur(sum(ordered))}</strong>
      </p>
      <p className="muted signed-note">✓ Fixed prices from offers signed by Valio Aimo</p>
    </section>
  );
}

const COURSE: Record<string, string> = { appetizer: 'Appetizer', main: 'Main', dessert: 'Dessert' };

const qty = (n: number, unit: string) => `${n.toLocaleString('fi-FI', { maximumFractionDigits: 3 })} ${unit === 'ST' ? 'pcs' : unit.toLowerCase()}`;

const pars = parLevels(history);

/** An amount far from the kitchen's usual one (reviewWeek on the demo history), asked about before anything is ordered. */
function unusual(text: string) {
  const lines = parseMessage(text).lines;
  const finding = reviewWeek(history, [], lines).find((f) => f.kind === 'quantity');
  const line = finding && lines.find((l) => l.item === finding.item);
  const par = finding && pars.get(finding.item);
  if (!line || !par || par.unit !== line.unit) return undefined;
  const usual = Math.round(par.median);
  const times = line.quantity / usual;
  const asked = qty(line.quantity, line.unit);
  return {
    text,
    asked,
    usual: qty(usual, line.unit),
    fixed: lines.map((l) => `${l === line ? usual : l.quantity} ${l.unit} ${l.item}`).join(', '),
    message: `${asked} is ${times >= 1 ? `${Math.round(times)}x` : `1/${Math.round(1 / times)} of`} your usual ${qty(usual, line.unit)}. Did you mean ${usual}?`,
  };
}

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Europe/Helsinki' }).format(new Date(`${iso}T12:00:00Z`));

function MenuPlanView({ result, title }: { result: MenuResult; title?: string }) {
  const { plan, lines } = result;
  const hasPlan = plan.dishes.length > 0;
  return (
    <>
      {title && <h2 className="result-title">{title}</h2>}
      {hasPlan && (
      <section className="card" aria-labelledby="plan-h">
        <h2 id="plan-h">Your plan</h2>
        <p className="request">
          {plan.meal ? `${plan.meal[0]!.toUpperCase()}${plan.meal.slice(1)}` : 'Order'} for {plan.servings} · delivery{' '}
          {plan.neededBy ? day(plan.neededBy) : 'next available day'}
        </p>
        <ul className="menu-dishes">
          {plan.dishes.map((d) => (
            <li key={d.dish}>
              {d.course && <span className="muted">{COURSE[d.course]}: </span>}
              {d.dish}
            </li>
          ))}
        </ul>
        {plan.unknownDishes.length > 0 && (
          <p className="notice">Please list the ingredients for: {plan.unknownDishes.join(', ')}</p>
        )}
        <h3>What Mikko assumed</h3>
        <ul className="menu-assumptions muted">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>
      )}

      <section className="card" aria-labelledby="lines-h">
        <div className="card-head">
          <h2 id="lines-h">{hasPlan ? 'Shopping list' : 'Added to your order'}</h2>
        </div>
        <ul className="menu-lines">
          {lines.map((l) => {
            const s = LINE_STATUS[l.status];
            return (
              <li key={l.name} className="menu-line">
                <div className="menu-line-head">
                  <ProductPhoto productId={l.productId} name={l.product ?? l.name} size={48} />
                  <strong className="menu-line-name">{l.name}</strong>
                  <span className="qty">{qty(l.quantity, l.unit)}</span>
                </div>
                <p className="muted">{l.product ?? 'No suitable product'}</p>
                <span className={`badge tone-${s.tone}`}>{s.label}</span>
                <ReasonChips codes={l.reasonCodes as ReasonCode[]} />
              </li>
            );
          })}
        </ul>
        {!hasPlan && plan.assumptions.length > 0 && <p className="muted">{plan.assumptions.join(' · ')}</p>}
      </section>

      <WhatWasOrdered lines={lines} />
    </>
  );
}

/** A product is short: Mikko shows the substitute (photo, reason, price) and orders only after the chef accepts. */
function SubstituteOffer({ order, onAccept, onWait }: { order: UiOrder; onAccept: () => void; onWait: () => void }) {
  const sub = order.lines.find((l) => l.substituteFor)!;
  const short = order.lines.find((l) => l.productId === sub.substituteFor)?.productName ?? `Product ${sub.substituteFor}`;
  const [reason, calc] = firstSentence(substituteReasons(order).get(sub.lineId) ?? 'Same category, allowed by your mandate.');
  return (
    <section className="card sub-offer" aria-labelledby="sub-h" data-tour="substitute">
      <h2 id="sub-h">{short} is running short</h2>
      <ul className="compact-lines">
        <li className="compact-line">
          <ProductPhoto productId={sub.productId} name={sub.productName} />
          <div className="compact-text">
            <strong>{sub.productName}</strong>
            <span className="muted">
              {sub.quantity} × {eur(sub.unitPrice)}
            </span>
          </div>
          <span className="compact-price">{eur(sub.totals.gross)}</span>
        </li>
      </ul>
      <p>{reason}</p>
      {calc && (
        <details className="more">
          <summary>Details</summary>
          <p>{calc}</p>
        </details>
      )}
      <div className="button-row">
        <button type="button" className="btn primary" onClick={onAccept}>
          Accept substitute
        </button>
        <button type="button" className="btn quiet" onClick={onWait}>
          Keep waiting
        </button>
      </div>
    </section>
  );
}

/** `tour`: the demo tour step on screen; it types its request, and may send it and answer the quantity check. */
export function RequestForm({ api, tour }: { api: GatewayApi; tour?: Pick<TourStep, 'ask' | 'send' | 'fix'> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [order, setOrder] = useState<UiOrder>();
  const [results, setResults] = useState<MenuResult[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string>();
  const [flag, setFlag] = useState<ReturnType<typeof unusual>>();
  const [proposal, setProposal] = useState<{ text: string; order: UiOrder }>();
  const [note, setNote] = useState<string>();

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setOrder(undefined);
    setResults([]);
    setFlag(undefined);
    setProposal(undefined);
    setNote(undefined);
    try {
      await job();
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Mock flow (no planMenu): an unusual amount is asked about, a short product gets a substitute offer, only then the order goes out.
  const place = async (t: string, checked = false) => {
    const slip = checked ? undefined : unusual(t);
    const draft = !slip && api instanceof MockGatewayApi ? await api.preview(t) : undefined;
    if (slip) setFlag(slip);
    else if (draft?.lines.some((l) => l.substituteFor)) setProposal({ text: t, order: draft });
    else setOrder(await api.submitRequest(t));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Write or scan what you need first.');
      return;
    }
    const t = text.trim();
    await run(async () => (api.planMenu ? setResults([await api.planMenu(t)]) : place(t)));
  };

  // Runs once: App remounts this form for every tour step, so each step starts from a clean screen.
  useEffect(() => {
    const ask = tour?.ask;
    if (!ask) return;
    if (!tour.send) setText(ask);
    else void run(() => place(tour.fix ? (unusual(ask)?.fixed ?? ask) : ask));
  }, []);

  const sendFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!api.planMenu || !followUp.trim()) {
      setFollowError('Write a correction or what to add first.');
      return;
    }
    setFollowBusy(true);
    setFollowError(undefined);
    try {
      const result = await api.planMenu(followUp.trim(), { neededBy: results[0]?.plan.neededBy ?? null });
      setResults((prev) => [...prev, result]);
      setFollowUp('');
    } catch (err) {
      setFollowError(err instanceof Error ? err.message : String(err));
    } finally {
      setFollowBusy(false);
    }
  };

  // One composer: a new request first, then corrections to the plan on screen (same delivery day).
  const started = results.length > 0;
  const [value, setValue] = started ? [followUp, setFollowUp] : [text, setText];
  const shownError = started ? followError : error;
  // One Approve for every result on screen, so corrections never add a second primary button.
  const waiting = results.reduce((n, r) => n + r.lines.filter((l) => l.status === 'needs_approval').length, 0);

  return (
    <div className="new-order">
      <h1 className={started || order || flag || proposal || note ? 'visually-hidden' : 'new-order-greet'}>What do you need, chef?</h1>

      <div role="status" aria-live="polite">
        {results.map((r, i) => (
          <MenuPlanView key={i} result={r} title={i === 0 ? undefined : `Update ${i}`} />
        ))}
        {waiting > 0 && (
          <p>
            <a className="btn primary" href="#/queue">
              Approve {waiting} {waiting === 1 ? 'line' : 'lines'}
            </a>
          </p>
        )}
        {flag && (
          <section className="card" aria-labelledby="flag-h" data-tour="qty-flag">
            <h2 id="flag-h">Check the quantity</h2>
            <p>{flag.message}</p>
            <p className="muted">Nothing is ordered yet.</p>
            <div className="button-row">
              <button type="button" className="btn primary" onClick={() => void run(() => place(flag.fixed))}>
                Use {flag.usual}
              </button>
              <button type="button" className="btn quiet" onClick={() => void run(() => place(flag.text, true))}>
                Keep {flag.asked}
              </button>
            </div>
          </section>
        )}
        {proposal && (
          <SubstituteOffer
            order={proposal.order}
            onAccept={() => void run(async () => setOrder(await api.submitRequest(proposal.text)))}
            onWait={() => {
              setProposal(undefined);
              setNote('Nothing ordered. Ask Mikko again when the stock is back.');
            }}
          />
        )}
        {note && <p className="card">{note}</p>}
        {order && (
          <section className="card" aria-label="Result">
            <div className="card-head">
              <h2>Order {order.orderId}</h2>
              <StatusBadge status={order.status} />
            </div>
            <ReasonChips codes={order.decision.reasonCodes} />
            <WhyText order={order} />
            <p>
              <a href={`#/orders/${order.orderId}`}>Open decision record for {order.orderId}</a>
            </p>
          </section>
        )}
      </div>

      <form onSubmit={started ? sendFollowUp : submit} noValidate className="request-form composer-dock" data-tour="composer">
        {shownError && (
          <p className="error" id="request-error" role="alert">
            {shownError}
          </p>
        )}
        <label htmlFor="request-text" className="visually-hidden">
          {started ? 'Correction or new order' : 'What do you need?'}
        </label>
        <CaptureBar
          targetId="request-text"
          api={api}
          hasText={!!value.trim()}
          working={busy ? 'Planning and ordering…' : followBusy ? 'Ordering…' : undefined}
          onText={(t, mode) => setValue((prev) => (mode === 'append' && prev.trim() ? `${prev.trim()} ${t}` : t))}
        >
          <textarea
            id="request-text"
            rows={1}
            maxLength={2000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask Mikko…"
            aria-describedby={shownError ? 'request-error' : undefined}
            aria-invalid={shownError ? true : undefined}
          />
        </CaptureBar>
      </form>
    </div>
  );
}
