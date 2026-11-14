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

export function Orders({ api }: { api: GatewayApi }) {
  const { data: orders, error } = useLive(api, () => api.listOrders(), 'my-orders');
  const mine = (orders ?? []).filter((o) => o.customerRef === AURORA).reverse();

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
          <p className="stat-value">{due.length} items</p>
          <p className="due-list">{due.map(([item]) => item).join(', ')}</p>
          <p className="stat-foot">
            <a className="on-accent" href="#/new">
              Order them in the chat
            </a>
          </p>
        </section>

        <section className="card chart-card" aria-labelledby="spend-title">
          <div className="card-head">
            <div>
              <h2 id="spend-title" className="card-title">
                Weekly spend
              </h2>
              <p className="muted">
                Weeks {weeks[0]!.week} to {weeks.at(-1)!.week}, excl. VAT
              </p>
            </div>
            <p className="chart-avg">
              <span className="muted">Average</span>
              <strong className="num">{eur(average)}</strong>
            </p>
          </div>
          <ol className="bars" aria-label="Spend per week">
            {weeks.map((w, i) => (
              <li key={w.week} className={i === weeks.length - 1 ? 'latest' : undefined}>
                <span className="bar" style={{ height: `${Math.max(4, (w.net / peak) * 100)}%` }} />
                <span className="bar-label">
                  <span className="visually-hidden">Week </span>
                  <span aria-hidden="true">W</span>
                  {w.week}
                </span>
                <span className="visually-hidden">: {eur(w.net)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Heatmap />

      <section className="card" aria-labelledby="usual-title">
        <h2 id="usual-title" className="card-title">
          Your usual week
        </h2>
        <p className="muted">What you normally order. The agent checks every order against it.</p>
        <div className="table-wrap">
          <table className="usual">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num-col">
                  Usual
                </th>
                <th scope="col" className="hide-sm">
                  Rhythm
                </th>
                <th scope="col" className="hide-sm">
                  Last 12 weeks
                </th>
              </tr>
            </thead>
            <tbody>
              {pars.map(([item, p]) => {
                const series = history.map((w) => w.orders.find((o) => o.item === item)?.quantity ?? 0);
                const top = Math.max(...series);
                return (
                  <tr key={item}>
                    <th scope="row">{item}</th>
                    <td className="num num-col">
                      {qty(p.median >= 10 ? Math.round(p.median) : Math.round(p.median * 10) / 10)} {p.unit}
                    </td>
                    <td className="hide-sm muted">{p.every === 1 ? 'Every week' : `Every ${p.every} weeks`}</td>
                    <td className="hide-sm">
                      <span className="spark" aria-hidden="true">
                        {series.map((v, i) => (
                          <span key={i} style={{ height: `${v ? Math.max(12, (v / top) * 100) : 4}%` }} className={v ? undefined : 'gap'} />
                        ))}
                      </span>
                      <span className="visually-hidden">Ordered in {series.filter(Boolean).length} of 12 weeks</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

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
  return (
    <section className="card" aria-labelledby="heat-title">
      <div className="card-head">
        <div>
          <h2 id="heat-title" className="card-title">
            Your year
          </h2>
          <p className="muted">One square per week. Darker means you spent more.</p>
        </div>
        <p className="chart-avg">
          <span className="muted">Busiest week</span>
          <strong>
            W{busiest.week}, <span className="num">{eur(busiest.spend)}</span>
          </strong>
        </p>
      </div>
      <div className="heat-wrap">
        <div className="heat" role="img" aria-label={`Spend per item and week in 2026, weeks 1 to ${thisWeek - 1}. Busiest week: week ${busiest.week}.`}>
          <span />
          {Array.from({ length: WEEKS_IN_YEAR / 4 }, (_, i) => (
            <span key={i} className="heat-week" style={{ gridColumn: `${i * 4 + 2} / span 4` }}>
              W{i * 4 + 1}
            </span>
          ))}
          {heatRows.map((row) => (
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
      <p className="heat-legend" aria-hidden="true">
        Less <span className="cell l0" /> <span className="cell l1" /> <span className="cell l2" /> <span className="cell l3" /> <span className="cell l4" /> More
      </p>
    </section>
  );
}
