import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { AIMO_PRODUCTS } from './aimoProducts';
import { ProductFacts } from './screens/Compact';

test('a known product shows its on-time badge; an unknown product shows nothing', () => {
  const known = Object.values(AIMO_PRODUCTS).find((p) => p.reliability !== null)!;
  const { unmount } = render(<ProductFacts productId={known.productId} />);
  expect(screen.getByText(/% on time$/)).toBeTruthy();
  expect(screen.getByText(/^Delivered as ordered in .* % of past orders$/)).toBeTruthy();
  unmount();
  expect(render(<ProductFacts productId="no-such-product" />).container.innerHTML).toBe('');
});
