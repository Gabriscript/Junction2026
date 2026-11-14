import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { MockGatewayApi, toolPath } from './api';
import { App } from './App';
import { auditChain } from '@junction/shared/fixtures';
import { verifyChain } from './hash';
import { eur, vatPercent } from './ui';

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
  const row = screen.getByRole('link', { name: /City Hospital kitchen/ }).closest('tr')!;
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

  await act(() => api.tamper(3));

  expect(await screen.findByText('Chain broken ✗')).toBeTruthy();
  expect(screen.getByText(/Event #3 does not match its hash/)).toBeTruthy();
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

test('money is decimal EUR shown as Finnish euros, VAT rate is a percent', async () => {
  expect(eur(1899).replace(/\s/g, ' ')).toBe('1 899,00 €');
  expect(vatPercent(13.5)).toBe('13,5 %');
  expect((await new MockGatewayApi().getOrder('ord-1002')).totals).toEqual({ net: 270, vat: 36.45, gross: 306.45, currency: 'EUR' });
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
  render(<App api={api} />);
  const box = await screen.findByLabelText('Message the purchasing agent');

  fireEvent.change(box, { target: { value: 'My usual order, but 5000 L milk' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(await screen.findByText(/5,000 L of milk .* did you mean 500 L\?/)).toBeTruthy();
  // the confirm names the risk instead of a generic "are you sure"
  expect(screen.getByRole('button', { name: 'Send with 5,000 L milk' })).toBeTruthy();
  expect(await api.listOrders()).toHaveLength(before);

  fireEvent.keyDown(screen.getByLabelText('Message the purchasing agent'), { key: 'Enter' });
  expect(await screen.findByText(/Sent\. Order ord-1004/)).toBeTruthy();
  const order = (await api.listOrders()).at(-1)!;
  expect(order.lines.find((l) => l.productId === '463335')).toMatchObject({ quantity: 5000, unit: 'L' });
});

test('chat: one-tap fixes and the attached menu, then the order goes out corrected', async () => {
  const api = new MockGatewayApi();
  render(<App api={api} />);
  fireEvent.change(await screen.findByLabelText('Message the purchasing agent'), { target: { value: 'My usual order, but 5000 L milk and no basil' } });
  fireEvent.submit(screen.getByLabelText('Message the purchasing agent').closest('form')!);
  await screen.findByRole('list', { name: 'Open questions' });

  fireEvent.click(screen.getByRole('button', { name: 'Use 500 L' }));
  fireEvent.click(screen.getByRole('button', { name: /^Add .* KG basil$/ }));
  expect(screen.queryByRole('list', { name: 'Open questions' })).toBeNull();

  // a menu photo brings in the new dish: the agent asks about its ingredient
  const photo = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
  fireEvent.change(photo, { target: { files: [new File(['x'], 'menu-week-47.jpg', { type: 'image/jpeg' })] } });
  fireEvent.keyDown(screen.getByLabelText('Message the purchasing agent'), { key: 'Enter' });
  expect(await screen.findByText(/I used the sample menu/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Add wurstel' }));
  fireEvent.change(screen.getByLabelText('Quantity of wurstel'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Send order' }));
  await screen.findByText(/Sent\. Order/);
  const lines = (await api.listOrders()).at(-1)!.lines.map((l) => [l.productId, l.quantity]);
  expect(lines).toEqual(expect.arrayContaining([['463335', 500], ['463022', 5]]));
  expect(lines.some(([id]) => id === '460533')).toBe(true);
});

test('orders dashboard: the 2026 heatmap shows the total first, products on request; recent orders listed', async () => {
  window.location.hash = '#/orders';
  render(<App api={new MockGatewayApi()} />);
  const heat = (await screen.findByRole('heading', { name: '2026' })).closest('section')!;
  expect(within(heat).getByText('All items')).toBeTruthy();
  expect(within(heat).queryByText('milk')).toBeNull();
  fireEvent.click(within(heat).getByRole('button', { name: 'Show each product' }));
  expect(within(heat).getByText('milk')).toBeTruthy();
  fireEvent.click(within(heat).getByRole('button', { name: 'Hide products' }));
  expect(within(heat).queryByText('milk')).toBeNull();
  expect(screen.queryByText('Your usual week')).toBeNull();
  expect(await screen.findByRole('link', { name: /1,000 L lactose-free milk/ })).toBeTruthy();
});

test('a substitute line shows what it replaces and the agent\'s reason', async () => {
  render(<App api={new MockGatewayApi()} />);
  await go('#/orders/ord-1000');
  const note = await screen.findByText(/Substitute for Lactose-free milk bag-in-box 10 L/);
  expect(note.closest('p')?.textContent).toMatch(/Only 40 of the 100 bag-in-box packs .* 1 140 € instead of 1 209,60 €/);
});

test('the + menu closes on a click outside it and on Escape', async () => {
  window.location.hash = '#/new';
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

test('due this week shows a short bullet list; the count and "View full list" open all of it', async () => {
  window.location.hash = '#/orders';
  render(<App api={new MockGatewayApi()} />);
  const card = (await screen.findByText('Due this week')).closest('section')!;
  const shown = () => within(card).getAllByRole('listitem').length;
  expect(shown()).toBe(5);
  fireEvent.click(within(card).getByRole('button', { name: /^\d+ items$/ }));
  expect(shown()).toBe(8);
  fireEvent.click(within(card).getByRole('button', { name: 'Show fewer' }));
  expect(shown()).toBe(5);
  fireEvent.click(within(card).getByRole('button', { name: 'View full list (8)' }));
  expect(shown()).toBe(8);
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
  expect(within(chart).getByText('milk')).toBeTruthy();
});
