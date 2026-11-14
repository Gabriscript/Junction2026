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
  render(<App api={api} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Approve order ord-1002' }));

  await screen.findByText('Nothing is waiting for approval.');
  const row = screen.getByRole('link', { name: /City Hospital kitchen/ });
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
