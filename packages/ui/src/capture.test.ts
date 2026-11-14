import { expect, test } from 'vitest';
import { csvToText } from './screens/Capture';

test('CSV order sheets become one line per row (comma or Finnish semicolon)', () => {
  expect(csvToText('product,quantity,unit\nfusilli,2,kg\n"basil pesto",1,crate\n')).toBe('product quantity unit\nfusilli 2 kg\nbasil pesto 1 crate');
  expect(csvToText('tuote;määrä\nmaito;10\n')).toBe('tuote määrä\nmaito 10');
});
