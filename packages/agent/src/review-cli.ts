/**
 * Demo scene "before you send": this week's draft orders checked against a synthetic 12-week
 * history and the menu. Pass orders as "item=quantity" to try your own, e.g. milk=5000 basil=0.
 *   npx tsx packages/agent/src/review-cli.ts
 */
import { DEMO_MENU, expectedWeek, reviewWeek, syntheticHistory, type WeekOrder } from './history.js';

const history = syntheticHistory(7, 12, '2026-11-16'); // synthetic: the dataset has no order history
let week: WeekOrder[] = expectedWeek(history);
// default draft: the classic slips, an extra zero on the milk and the basil forgotten
const changes = process.argv.length > 2 ? process.argv.slice(2) : ['milk=5000', 'basil=0'];
for (const change of changes) {
  const [item, value] = change.split('=');
  const quantity = Number(value);
  if (!item || !Number.isFinite(quantity) || quantity < 0) throw new Error(`Expected item=quantity, got "${change}"`);
  week = quantity === 0 ? week.filter((o) => o.item !== item) : week.map((o) => (o.item === item ? { ...o, quantity } : o));
}

console.log(`Menu: ${DEMO_MENU.map((d) => d.name).join(', ')}`);
console.log(`This week's draft: ${week.map((o) => `${o.item} ${o.quantity} ${o.unit}`).join(', ')}\n`);
const findings = reviewWeek(history, DEMO_MENU, week);
if (!findings.length) console.log('Nothing to ask: nothing forgotten, no unusual quantity.');
findings.forEach((f, i) => console.log(`${i + 1}. [${f.kind}] ${f.message}`));
