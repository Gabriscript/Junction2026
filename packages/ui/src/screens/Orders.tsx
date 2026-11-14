import { useId, useState } from 'react';
import { AIMO_PRODUCTS } from '../aimoProducts';
import type { GatewayApi } from '../api';
import { history, isoWeek, KITCHEN, parLevels, THIS_MONDAY, yearHistory } from '../kitchen';
import { DEMO_UNIT_PRICES, FALLBACK_UNIT_PRICE } from '../mockData';
import { eur, Icon, StatusBadge, time, useLive } from '../ui';

const AURORA = '300'; // the signed-in kitchen's customerRef in the demo data
const pars = [...parLevels(history)].sort(([, a], [, b]) => a.every - b.every || b.median - a.median);
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const spendOf = (o: { item: string; quantity: number }) => Math.round(o.quantity * (DEMO_UNIT_PRICES[o.item] ?? FALLBACK_UNIT_PRICE) * 100) / 100;

/** Spend per past week, ex VAT, from the synthetic history and the demo unit prices (integer cents). */
const weeks = history.map((w) => ({
  week: isoWeek(w.week),
  net: w.orders.reduce((s, o) => s + Math.round(spendOf(o) * 100), 0) / 100,
}));
const peak = Math.max(...weeks.map((w) => w.net));
const average = weeks.reduce((s, w) => s + w.net, 0) / weeks.length;
const due = pars.filter(([, p]) => p.weeksSince >= p.every);
const WINDOW = 4; // weeks on screen; the arrows page back through the 12 the review uses
const DUE_SHOWN = 5; // what fits the card beside the chart; the rest open with "View full list"

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function WeeklySpend() {
  const [end, setEnd] = useState(weeks.length); // window is weeks[end - WINDOW, end)
  const [picked, setPicked] = useState(weeks.length - 1);
  const shown = weeks.slice(end - WINDOW, end);
  const week = history[picked]!;
  const lines = week.orders.map((o) => ({ ...o, net: spendOf(o) }));

  return (
    <section className="card chart-card" aria-labelledby="spend-title">
      <div className="card-head">
        <div>
          <h2 id="spend-title" className="card-title">
            Weekly spend
          </h2>
          <p className="muted">
            Weeks {shown[0]!.week} to {shown.at(-1)!.week}, excl. VAT
          </p>
        </div>
        <p className="chart-avg">
          <span className="muted">12-week average</span>
          <strong className="num">{eur(average)}</strong>
        </p>
      </div>
      <div className="bars-row">
        <button type="button" className="page-btn" aria-label="Earlier weeks" disabled={end <= WINDOW} onClick={() => setEnd(end - WINDOW)}>
          <Icon name="back" />
        </button>
        <ol className="bars" aria-label="Spend per week. Pick a week to see what you ordered.">
          {shown.map((w, j) => {
            const i = end - WINDOW + j;
            return (
              <li key={w.week}>
                <button type="button" className={i === picked ? 'bar-btn picked' : 'bar-btn'} aria-pressed={i === picked} aria-label={`Week ${w.week}: ${eur(w.net)}`} onClick={() => setPicked(i)}>
                  <span className="bar" style={{ height: `${Math.max(4, (w.net / peak) * 100)}%` }} />
                  <span className="bar-label">W{w.week}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" className="page-btn" aria-label="Later weeks" disabled={end >= weeks.length} onClick={() => setEnd(end + WINDOW)}>
          <Icon name="next" />
        </button>
      </div>
      <div className="week-detail" aria-live="polite">
        <p className="week-detail-head">
          <strong>
            Week {weeks[picked]!.week}, delivery {day(week.week)}
          </strong>
          <strong className="num">{eur(weeks[picked]!.net)}</strong>
        </p>
        <ul className="week-lines">
          {lines.map((o) => (
            <li key={o.item}>
              <span>
                {o.item}
                {AIMO_PRODUCTS[o.item] && <span className="week-product">{AIMO_PRODUCTS[o.item]!.name}</span>}
              </span>
              <span className="num">
                {qty(o.quantity >= 10 ? Math.round(o.quantity) : Math.round(o.quantity * 10) / 10)} {o.unit}
              </span>
              <span className="num">{eur(o.net)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Orders({ api }: { api: GatewayApi }) {
  const { data: orders, error } = useLive(api, () => api.listOrders(), 'my-orders');
  const mine = (orders ?? []).filter((o) => o.customerRef === AURORA).reverse();
  const [allDue, setAllDue] = useState(false);
  const dueId = useId();
  const more = due.length > DUE_SHOWN;

  return (
    <>
      <header className="page-head">
        <h1>Orders</h1>
        <p className="lead">What you order and what is due.</p>
        <p className="muted">{KITCHEN}. Demo data.</p>
      </header>
      {error && (
        <p className="error" role="alert">
          Could not load orders. {error}
        </p>
      )}

      <div className="dash-grid">
        <section className="stat stat-main" aria-labelledby="due-title">
          <p className="stat-title">
            <span className="tile">
              <Icon name="review" />
            </span>
            <span>
              <strong id="due-title">Due this week</strong>
              <span>Delivery Mon 16 Nov</span>
            </span>
          </p>
          <p className="stat-value">
            {more ? (
              <button type="button" className="stat-link" aria-expanded={allDue} aria-controls={dueId} onClick={() => setAllDue(true)}>
                {due.length} items
              </button>
            ) : (
              `${due.length} items`
            )}
          </p>
          <ul id={dueId} className="due-list">
            {(allDue ? due : due.slice(0, DUE_SHOWN)).map(([item]) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {more && (
            <button type="button" className="due-more" aria-expanded={allDue} aria-controls={dueId} onClick={() => setAllDue(!allDue)}>
              {allDue ? 'Show fewer' : `View full list (${due.length})`}
            </button>
          )}
          <p className="stat-foot">
            <a className="on-accent" href="#/new">
              Order them in the chat
            </a>
          </p>
        </section>

        <WeeklySpend />
      </div>

      <Heatmap />

      <section className="card" aria-labelledby="mine-title">
        <h2 id="mine-title" className="card-title">
          Recent orders
        </h2>
        {orders && mine.length === 0 && <p className="empty">No orders yet.</p>}
        {mine.length > 0 && (
          <div className="table-wrap">
            <table className="orders">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col" className="hide-sm">
                    Placed
                  </th>
                  <th scope="col" className="hide-sm num-col">
                    Total incl. VAT
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((order) => (
                  <tr key={order.orderId}>
                    <th scope="row">
                      <a href={`#/orders/${order.orderId}`}>{order.requestText}</a>
                      <span className="muted">
                        {order.orderId}, {order.lines.length} lines<span className="show-sm">, {eur(order.totals.gross)}</span>
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

const WEEKS_IN_YEAR = 52; // 2026 has 53 ISO weeks; the grid shows the usual 52, like a wall planner
const thisWeek = isoWeek(THIS_MONDAY);

/** 0 = nothing ordered, 1-4 = quartile of the spend among the cells that have one (GitHub-style). */
function levels(values: number[]) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const cut = [0.25, 0.5, 0.75].map((q) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
  return (v: number) => (v <= 0 ? 0 : v <= cut[0]! ? 1 : v <= cut[1]! ? 2 : v <= cut[2]! ? 3 : 4);
}

type Line = { item: string; quantity: number; unit: string };
const byWeek = new Map(yearHistory.map((w) => [isoWeek(w.week), w.orders as Line[]]));
// spend < 0 marks a week with no data yet (this week and the rest of the year)
const cells = (pick: (orders: Line[]) => { spend: number; note: string }) =>
  Array.from({ length: WEEKS_IN_YEAR }, (_, i) => {
    const orders = byWeek.get(i + 1);
    return orders ? { week: i + 1, ...pick(orders) } : { week: i + 1, spend: -1, note: '' };
  });
const itemRows = pars.map(([item]) => ({
  label: item,
  cells: cells((orders) => {
    const o = orders.find((x) => x.item === item);
    return o ? { spend: spendOf(o), note: `${qty(o.quantity)} ${o.unit}, ${eur(spendOf(o))}` } : { spend: 0, note: 'not ordered' };
  }),
}));
const totalRow = {
  label: 'All items',
  cells: cells((orders) => {
    const spend = orders.reduce((s, o) => s + Math.round(spendOf(o) * 100), 0) / 100;
    return { spend, note: `${orders.length} lines, ${eur(spend)}` };
  }),
};
const itemLevel = levels(itemRows.flatMap((r) => r.cells.map((c) => c.spend)));
const heatRows = [{ ...totalRow, level: levels(totalRow.cells.map((c) => c.spend)) }, ...itemRows.map((r) => ({ ...r, level: itemLevel }))];
const busiest = totalRow.cells.reduce((a, b) => (b.spend > a.spend ? b : a));

function Heatmap() {
  const [byItem, setByItem] = useState(false);
  const rows = byItem ? heatRows : heatRows.slice(0, 1);
  return (
    <section className="card" aria-labelledby="heat-title">
      <div className="card-head">
        <div>
          <h2 id="heat-title" className="card-title">
            2026
          </h2>
        </div>
        <p className="chart-avg">
          <span className="muted">Busiest week</span>
          <strong>
            W{busiest.week}, <span className="num">{eur(busiest.spend)}</span>
          </strong>
        </p>
      </div>
      <div className="heat-wrap">
        <div id="heat-grid" className="heat" role="img" aria-label={`Spend ${byItem ? 'per item ' : ''}and week in 2026, weeks 1 to ${thisWeek - 1}. Busiest week: week ${busiest.week}.`}>
          <span />
          {Array.from({ length: WEEKS_IN_YEAR / 4 }, (_, i) => (
            <span key={i} className="heat-week" style={{ gridColumn: `${i * 4 + 2} / span 4` }}>
              W{i * 4 + 1}
            </span>
          ))}
          {rows.map((row) => (
            <div key={row.label} className={row.label === totalRow.label ? 'heat-row heat-total' : 'heat-row'}>
              <span className="heat-label">{row.label}</span>
              {row.cells.map((c) => (
                <span
                  key={c.week}
                  className={`cell l${c.spend < 0 ? 'x' : row.level(c.spend)}${c.week === thisWeek ? ' now' : ''}`}
                  title={c.spend < 0 ? `W${c.week}: ${c.week === thisWeek ? 'this week' : 'not yet'}` : `W${c.week}, ${row.label}: ${c.note}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="heat-foot">
        <button type="button" className="more-btn" aria-expanded={byItem} aria-controls="heat-grid" onClick={() => setByItem(!byItem)}>
          {byItem ? 'Hide products' : 'Show each product'}
        </button>
        <p className="heat-legend" aria-hidden="true">
          Less <span className="cell l0" /> <span className="cell l1" /> <span className="cell l2" /> <span className="cell l3" /> <span className="cell l4" /> More
        </p>
      </div>
    </section>
  );
}
