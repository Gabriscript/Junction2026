import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { MockGatewayApi } from './api';
import { App } from './App';
import { STEPS } from './screens/Tour';

test('demo tour: one order through steps 1 to 1c (slip, then a substitute in the same request, nothing ordered before Accept), every step reaches its target, Esc returns focus', async () => {
  localStorage.removeItem('view');
  window.location.hash = '#/orders/ord-1000'; // starts on an unrelated order: step 1 must navigate away from it
  const api = new MockGatewayApi();
  const before = (await api.listOrders()).length;
  render(<App api={api} />);
  const button = screen.getByRole('button', { name: 'Demo tour' });
  fireEvent.click(button);
  const dialog = screen.getByRole('dialog', { name: STEPS[0]!.title });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.contains(document.activeElement)).toBe(true);

  for (const [i, step] of STEPS.entries()) {
    expect(within(dialog).getByRole('heading').textContent).toBe(step.title);
    expect(within(dialog).getByText(`Step ${i + 1} of ${STEPS.length}`)).toBeTruthy();
    const target = await waitFor(() => document.querySelector(step.target) ?? Promise.reject(new Error(`no ${step.target}`)), { timeout: 3000 });
    if (step.title === 'New order') expect((screen.getByLabelText('What do you need?') as HTMLTextAreaElement).value).toBe('3000 kg tomatoes, 100 L vanilla ice cream');
    if (step.title === 'Unusual quantity guard') {
      expect(target.textContent).toMatch(/3\s000 kg is 100x your usual 30 kg\. Did you mean 30\?/);
      expect(screen.queryByText(/is running short/)).toBeNull();
    }
    if (step.title === 'Product running out') {
      expect(screen.queryByText(/Check the quantity/)).toBeNull(); // "Use 30 kg" was applied
      expect(target.textContent).toMatch(/GelatoLAB-Espoo 5L ice cream Vanilla lactose-free is running short/);
      expect(target.textContent).toMatch(/Only 12 of 20 big tubs; 16 small tubs fill the gap, \+/);
      expect(within(target as HTMLElement).getByRole('button', { name: 'Accept substitute' })).toBeTruthy();
      expect(await api.listOrders()).toHaveLength(before); // flagged and proposed, nothing ordered yet
      // the proposal is the tour's own request: the tomato line, fixed to 30 kg, is in the same cart
      const draft = await api.preview('30 KG tomatoes, 100 L vanilla ice cream');
      expect(draft.lines.map((l) => [l.productName, l.quantity, l.substituteFor])).toEqual([
        ['TOMATO NL/BE/ES 1.CL', 30, null],
        ['GelatoLAB-Espoo 5L ice cream Vanilla lactose-free', 12, null],
        ['GelatoLAB-Espoo 2,5L ice cream Vanilla Tahiti lactose-free', 16, '465029'],
      ]);
    }
    if (i < STEPS.length - 1) fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
  }

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(button);
});

test('Accept substitute places one order with the tomato line and the substitute', async () => {
  window.location.hash = '#/new';
  const api = new MockGatewayApi();
  const before = (await api.listOrders()).length;
  render(<App api={api} />);
  fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: '30 kg tomatoes, 100 L vanilla ice cream' } });
  fireEvent.submit(screen.getByLabelText('What do you need?').closest('form')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Accept substitute' }));
  await screen.findByRole('heading', { name: /^Order ord-/ });
  const orders = await api.listOrders();
  expect(orders).toHaveLength(before + 1);
  expect(orders.at(-1)!.lines.map((l) => l.productName)).toContain('TOMATO NL/BE/ES 1.CL');
});
