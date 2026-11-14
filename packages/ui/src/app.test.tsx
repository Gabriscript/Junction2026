import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { MockGatewayApi, toolPath, type GatewayApi } from './api';
import { App } from './App';
import { auditChain } from '@junction/shared/fixtures';
import { verifyChain } from './hash';
import { eur, vatPercent } from './ui';
import { auroraOrder } from './mockData';
import { CompactLines } from './screens/Compact';

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

test('approving a pending order updates its status and appends an audit event, no reload', async () => {
  const api = new MockGatewayApi();
  const before = (await api.listAuditEvents('aimo')).length;
  window.location.hash = '#/queue';
  render(<App api={api} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Approve order ord-1002' }));

  await screen.findByText('Nothing is waiting for approval.');
  // ord-1002 is Hotel Aurora's now (the Kitchen's own), so the row is found by its order id, not the buyer
  const row = screen.getByRole('link', { name: 'Why order ord-1002 is approved' }).closest('tr')!;
  expect(within(row).getByText('Approved')).toBeTruthy();

  const events = await api.listAuditEvents('aimo');
  expect(events).toHaveLength(before + 1);
  expect(events.at(-1)).toMatchObject({ actor: { type: 'human' }, type: 'order_approved', orderId: 'ord-1002' });

  await go('#/audit');
  expect(await screen.findByText(/Order ord-1002 approved by Demo approver/)).toBeTruthy();
  expect(await screen.findByText('Chain verified ✓')).toBeTruthy();
});

test('rejecting asks for a reason inline and records it', async () => {
  const api = new MockGatewayApi();
  window.location.hash = '#/queue';
  render(<App api={api} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Reject order ord-1002' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
  expect(screen.getByRole('alert').textContent).toMatch(/reason/);
  expect((await api.getOrder('ord-1002')).status).toBe('pending_approval');

  fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: 'Wait for verified stock' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));

  await screen.findByText('Nothing is waiting for approval.');
  expect((await api.getOrder('ord-1002')).approval).toMatchObject({ outcome: 'rejected', comment: 'Wait for verified stock' });
});

test('reason code chips show the shared title and description, not only colour', async () => {
  window.location.hash = '#/queue';
  render(<App api={new MockGatewayApi()} />);
  const chips = await screen.findByRole('list', { name: 'Reason codes' });
  expect(within(chips).getByText('Partial availability')).toBeTruthy();
  expect(within(chips).getByText('Stock not verified')).toBeTruthy();
  expect(within(chips).getByText('UNVERIFIED_STOCK')).toBeTruthy();
  expect(within(chips).getByText(/Valio Aimo cannot confirm the quantity/)).toBeTruthy();
});

test('tampering with one audit event makes the chain indicator show broken', async () => {
  const api = new MockGatewayApi();
  window.location.hash = '#/audit';
  render(<App api={api} />);
  expect(await screen.findByText('Chain verified ✓')).toBeTruthy();

  // the Kitchen audit shows only Hotel Aurora's events: #3 is Harbour Hotel's, so tamper with #2 (Aurora)
  await act(() => api.tamper(2));

  expect(await screen.findByText('Chain broken ✗')).toBeTruthy();
  expect(screen.getByText(/Event #2 does not match its hash/)).toBeTruthy();
});

test('a new pending order from a request is announced and shown live', async () => {
  const api = new MockGatewayApi();
  window.location.hash = '#/queue';
  render(<App api={api} />);
  await screen.findByRole('button', { name: 'Approve order ord-1002' });

  await act(async () => {
    await api.submitRequest('20 kg rice');
  });

  expect(await screen.findByRole('button', { name: 'Approve order ord-1004' })).toBeTruthy();
  expect(await screen.findByText(/New order needs approval: ord-1004/)).toBeTruthy();
});

test('mock requests from the Kitchen become Hotel Aurora orders, ice cream included', async () => {
  const api = new MockGatewayApi();
  for (const text of ['50 L gelato for Friday', '20 kg rice']) {
    expect(await api.submitRequest(text)).toMatchObject({ customerRef: '300', buyerName: 'Hotel Aurora kitchen (demo)', agentId: 'agent:aurora-kitchen', mandateId: 'mandate-aurora-01' });
  }
});

test('money is decimal EUR shown as Finnish euros, VAT rate is a percent', async () => {
  expect(eur(1899).replace(/\s/g, ' ')).toBe('1 899,00 €');
  expect(vatPercent(13.5)).toBe('13,5 %');
  expect((await new MockGatewayApi().getOrder('ord-1002')).totals).toEqual({ net: 483.28, vat: 65.25, gross: 548.53, currency: 'EUR' });
});

test('verifyChain: seed is valid, buyer view tolerates links outside the view, broken link is caught', async () => {
  const api = new MockGatewayApi();
  await api.approve('ord-1002', { type: 'human', id: 'user:tester' });
  const all = await api.listAuditEvents('aimo');
  expect(await verifyChain(all)).toEqual({ ok: true, outsideLinks: 0 });
  expect(await verifyChain(await api.listAuditEvents('buyer'))).toEqual({ ok: true, outsideLinks: 1 });

  all[4] = { ...all[4]!, prevHash: all[0]!.hash };
  expect(await verifyChain(all)).toMatchObject({ ok: false, brokenAt: 4 });
});

test('verifyChain follows the shared hashing rule: the shared fixture chain verifies, an edit breaks it', async () => {
  expect(await verifyChain(auditChain)).toEqual({ ok: true, outsideLinks: 0 });
  expect(await verifyChain(auditChain.filter((e) => e.visibility.includes('buyer')))).toEqual({ ok: true, outsideLinks: 0 });

  const edited = auditChain.map((e) => (e.seq === 2 ? { ...e, summary: `${e.summary} (edited)` } : e));
  expect(await verifyChain(edited)).toMatchObject({ ok: false, brokenAt: 2 });
});

test('REST paths come from the shared tool registry, path params encoded', () => {
  expect(toolPath('approve_order', { orderId: 'ord/1' })).toBe('/v1/orders/ord%2F1/approve');
  expect(toolPath('get_order', { orderId: 'ord-1' })).toBe('/v1/orders/ord-1');
});

test('chat: the first Enter reads back and flags the slips, nothing is ordered until the second Enter', async () => {
  const api = new MockGatewayApi();
  const before = (await api.listOrders()).length;
  window.location.hash = '#/chat'; // chat moved off the default tab (request screen is the main flow)
  render(<App api={api} />);
  const box = await screen.findByLabelText('Message the purchasing agent');

  fireEvent.change(box, { target: { value: 'My usual order, but 300 kg tomatoes' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(await screen.findByText(/300 KG of tomatoes .* did you mean 30 KG\?/)).toBeTruthy();
  // the confirm names the risk instead of a generic "are you sure"
  expect(screen.getByRole('button', { name: 'Send with 300 KG tomatoes' })).toBeTruthy();
  expect(await api.listOrders()).toHaveLength(before);

  fireEvent.keyDown(screen.getByLabelText('Message the purchasing agent'), { key: 'Enter' });
  expect(await screen.findByText(/Sent\. Order ord-1004/)).toBeTruthy();
  const order = (await api.listOrders()).at(-1)!;
  // the cart buys what Aimo sells: loose tomatoes by the kilo, at the real price
  expect(order.lines.find((l) => l.productId === '460027')).toMatchObject({ quantity: 300, unit: 'KG', unitPrice: 2.15 });
});

test('chat: one-tap fixes and the attached menu, then the order goes out corrected', async () => {
  const api = new MockGatewayApi();
  window.location.hash = '#/chat'; // chat moved off the default tab (request screen is the main flow)
  render(<App api={api} />);
  fireEvent.change(await screen.findByLabelText('Message the purchasing agent'), { target: { value: 'My usual order, but 300 kg tomatoes and no pesto' } });
  fireEvent.submit(screen.getByLabelText('Message the purchasing agent').closest('form')!);
  await screen.findByRole('list', { name: 'Open questions' });

  fireEvent.click(screen.getByRole('button', { name: 'Use 30 KG' }));
  fireEvent.click(screen.getByRole('button', { name: /^Add .* KG pesto$/ }));
  expect(screen.queryByRole('list', { name: 'Open questions' })).toBeNull();

  // a menu photo brings in the new dish: the agent asks about its ingredient
  const photo = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
  fireEvent.change(photo, { target: { files: [new File(['x'], 'menu-week-47.jpg', { type: 'image/jpeg' })] } });
  fireEvent.keyDown(screen.getByLabelText('Message the purchasing agent'), { key: 'Enter' });
  expect(await screen.findByText(/I used the sample menu/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Add ice cream' }));
  fireEvent.change(screen.getByLabelText('Quantity of ice cream'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Send order' }));
  await screen.findByText(/Sent\. Order/);
  const lines = (await api.listOrders()).at(-1)!.lines.map((l) => [l.productId, l.quantity]);
  // 20 of ice cream = 4 tubs of 5 L; the pesto came back from the usual week
  expect(lines).toEqual(expect.arrayContaining([['460027', 30], ['464967', 4]]));
  expect(lines.some(([id]) => id === '460979')).toBe(true);
});

test('orders dashboard: the 2026 heatmap shows the total first, products on request; recent orders listed', async () => {
  window.location.hash = '#/orders';
  render(<App api={new MockGatewayApi()} />);
  const heat = (await screen.findByRole('heading', { name: '2026' })).closest('section')!;
  expect(within(heat).getByText('All items')).toBeTruthy();
  expect(within(heat).queryByText('tomatoes')).toBeNull();
  fireEvent.click(within(heat).getByRole('button', { name: 'Show each product' }));
  expect(within(heat).getByText('tomatoes')).toBeTruthy();
  fireEvent.click(within(heat).getByRole('button', { name: 'Hide products' }));
  expect(within(heat).queryByText('tomatoes')).toBeNull();
  expect(screen.queryByText('Your usual week')).toBeNull();
  expect(await screen.findByRole('link', { name: /300 L lactose-free vanilla ice cream/ })).toBeTruthy();
  // the pending order lives on Approvals, not in Recent orders
  expect(screen.queryByRole('link', { name: /100 L lactose-free vanilla ice cream for Monday/ })).toBeNull();
});

test('a substitute line names what it replaces; the reason is in the Why fold', async () => {
  render(<App api={new MockGatewayApi()} />);
  await go('#/orders/ord-1000');
  const note = await screen.findByText(/Substitute for GelatoLAB-Espoo 5L ice cream Vanilla lactose-free/);
  expect(note.closest('li')?.closest('[aria-label="Cart lines"]')).toBeTruthy();
  const why = screen.getByText('Why Mikko chose this').closest('details')!;
  expect(within(why).getByText(/Only 40 of the 60 tubs of 5 L .* 1 432 € instead of 1 610,40 €/)).toBeTruthy();
});

test('the + menu closes on a click outside it and on Escape', async () => {
  window.location.hash = '#/chat';
  render(<App api={new MockGatewayApi()} />);
  const plus = await screen.findByRole('button', { name: 'Attach a menu photo or a file' });
  const menu = () => screen.queryByRole('button', { name: 'Photo of the menu' });
  fireEvent.click(plus);
  expect(menu()).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(menu()).toBeNull();
  fireEvent.click(plus);
  fireEvent.pointerDown(menu()!);
  expect(menu()).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(plus);
});

test('the sidebar collapses to icons, keeps link names and remembers the choice', async () => {
  localStorage.removeItem('side-collapsed');
  window.location.hash = '#/new';
  const { unmount } = render(<App api={new MockGatewayApi()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
  expect(screen.getAllByRole('link', { name: /^Orders/ })[0]!.getAttribute('title')).toBe('Orders');
  expect(localStorage.getItem('side-collapsed')).toBe('1');
  unmount();
  render(<App api={new MockGatewayApi()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Expand sidebar' }));
  expect(localStorage.getItem('side-collapsed')).toBe('0');
});

test('weekly spend shows 4 weeks, pages back through 12, and a picked week lists what was ordered', async () => {
  window.location.hash = '#/orders';
  render(<App api={new MockGatewayApi()} />);
  const chart = (await screen.findByRole('heading', { name: 'Weekly spend' })).closest('section')!;
  const bars = () => within(chart).getAllByRole('button', { pressed: undefined }).filter((b) => b.hasAttribute('aria-pressed'));
  expect(bars().map((b) => b.textContent)).toEqual([expect.stringContaining('W43'), expect.stringContaining('W44'), expect.stringContaining('W45'), expect.stringContaining('W46')]);
  const later = within(chart).getByRole('button', { name: 'Later weeks' }) as HTMLButtonElement;
  const earlier = within(chart).getByRole('button', { name: 'Earlier weeks' }) as HTMLButtonElement;
  expect(later.disabled).toBe(true);
  fireEvent.click(earlier);
  fireEvent.click(earlier);
  expect(bars()[0]!.textContent).toContain('W35');
  expect(earlier.disabled).toBe(true);
  fireEvent.click(within(chart).getByRole('button', { name: /Week 36/ }));
  expect(within(chart).getByText(/^Week 36, delivery/)).toBeTruthy();
  expect(within(chart).getByText('tomatoes')).toBeTruthy();
});

test('autopilot: switching it on sends the usual items due this Monday, minus the ones marked Ask me', async () => {
  const api = new MockGatewayApi();
  window.location.hash = '#/orders';
  render(<App api={api} />);
  const card = (await screen.findByRole('switch', { name: 'Autopilot' })).closest('section')!;
  expect(within(card).getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(within(card).getByRole('checkbox', { name: /Ask me before ordering tomatoes/ }));
  const before = (await api.listOrders()).length;
  fireEvent.click(within(card).getByRole('switch', { name: 'Autopilot' }));
  expect(await within(card).findByText(/Sent by Mikko/)).toBeTruthy();
  const orders = await api.listOrders();
  expect(orders).toHaveLength(before + 1);
  const sent = orders.at(-1)!;
  expect(sent.requestText).toMatch(/^Usual order for Mon 16 Nov: .*mozzarella/);
  expect(sent.requestText).not.toMatch(/tomatoes/);
  // the sent order is the cart the card showed: whole 125 g bags at the real price, same total incl. VAT
  expect(sent.lines.find((l) => l.productId === '468526')).toMatchObject({ quantity: 336, unit: 'BAG', unitPrice: 2.24 }); // 42 kg median / 0.125 kg
  expect(within(card).getByText(/6 items/).textContent).toContain(eur(sent.totals.gross));
});

test("a substitute line in the compact card carries a flag with Mikko's reason", () => {
  render(<CompactLines order={auroraOrder} />);
  const flag = screen.getByRole('button', { name: 'Substitute' });
  const tip = document.getElementById(flag.getAttribute('aria-describedby')!)!;
  expect(tip.getAttribute('role')).toBe('tooltip');
  expect(tip.textContent).toMatch(/^SubstituteOnly 40 of the 60 tubs of 5 L/);
});

test("the view switch hides other buyers' orders in Kitchen and shows them all in Valio Aimo", async () => {
  localStorage.removeItem('view');
  window.location.hash = '#/queue';
  render(<App api={new MockGatewayApi()} />);
  await screen.findByRole('button', { name: 'Approve order ord-1002' });
  expect(screen.queryByText(/Harbour Hotel/)).toBeNull();
  expect(screen.queryByText('Not verified')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Valio Aimo' }));
  expect(await screen.findByRole('heading', { name: 'All orders' })).toBeTruthy();
  expect(await screen.findByRole('link', { name: /Harbour Hotel/ })).toBeTruthy(); // rows load after the heading
  expect(screen.getByRole('link', { name: 'Why order ord-1003 is blocked' })).toBeTruthy();
  // Valio Aimo waits on the buyer; "Needs your OK" is the chef's wording
  expect(screen.getByRole('link', { name: 'Why order ord-1002 is pending approval' }).textContent).toBe('Awaiting buyer');
  expect(screen.getByRole('button', { name: 'Valio Aimo' }).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('view')).toBe('aimo');

  fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
  expect((await screen.findAllByRole('link', { name: /Approvals/ })).length).toBeGreaterThan(0);
  expect(screen.queryByRole('link', { name: /All orders/ })).toBeNull();
  expect(screen.queryByText(/Harbour Hotel/)).toBeNull();
  localStorage.removeItem('view');
});

test('the Demo tour button is on the live build too, and ?demo=tour opens the tour', async () => {
  const live = { listOrders: async () => [], listAuditEvents: async () => [], subscribe: () => () => {} } as unknown as GatewayApi;
  window.location.hash = '#/orders';
  const first = render(<App api={live} />);
  expect(await screen.findByRole('button', { name: /Demo tour/ })).toBeTruthy();
  first.unmount();

  window.history.pushState(null, '', '/?demo=tour');
  render(<App api={new MockGatewayApi()} />);
  expect(await screen.findByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  expect(window.location.search).toBe('?demo'); // a reload stays in the demo but no longer restarts the tour
  window.history.pushState(null, '', '/');
});
