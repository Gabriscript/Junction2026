import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HttpGatewayApi, type SubstituteProposal } from './api';
import type { MenuResult } from './contract';
import { RequestForm } from './screens/RequestForm';

const proposal: SubstituteProposal = {
  status: 'substitute_proposed',
  text: '100 L lactose-free milk',
  preview: {
    lines: [
      { productId: 'p-bib', productName: 'Milk bag-in-box 10 L', packs: 4, unitPrice: 10.5, grossEur: 47.67, substituteFor: null },
      { productId: 'p-case', productName: 'Milk case 12 x 1 L', packs: 5, unitPrice: 14.4, grossEur: 81.72, substituteFor: 'p-bib' },
    ],
    reason: 'Only 4 of 10 packs in stock. The case fills the gap.',
    grossEur: 129.39,
  },
};
const planned: MenuResult = {
  plan: { servings: 1, meal: null, neededBy: null, dishes: [], assumptions: [], unknownDishes: [] },
  lines: [{ name: 'lactose-free milk', quantity: 100, unit: 'L', usedIn: [], optional: false, status: 'auto_approved', reasonCodes: [], note: '' }],
};

afterEach(() => vi.unstubAllGlobals());

test('real path: the server proposes a substitute, nothing is ordered until the chef accepts', async () => {
  const bodies: Array<{ acceptSubstitutes?: boolean }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { acceptSubstitutes?: boolean };
      bodies.push(body);
      return new Response(JSON.stringify(body.acceptSubstitutes === false ? proposal : planned));
    }),
  );
  render(<RequestForm api={new HttpGatewayApi('http://assistant.test')} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: proposal.text } });
  await act(async () => fireEvent.submit(screen.getByRole('textbox').closest('form')!));

  expect(await screen.findByRole('heading', { name: 'Milk bag-in-box 10 L is running short' })).toBeTruthy();
  expect(screen.getByText('Only 4 of 10 packs in stock.')).toBeTruthy();
  expect(bodies).toEqual([{ text: proposal.text, neededBy: null, acceptSubstitutes: false }]);

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept substitute' })));
  expect(bodies[1]).toEqual({ text: proposal.text, neededBy: null }); // server default: substitutes accepted
  expect(screen.queryByRole('heading', { name: /running short/ })).toBeNull();
  expect(await screen.findByText('lactose-free milk')).toBeTruthy();
});
