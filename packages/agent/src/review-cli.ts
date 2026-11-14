/**
 * Demo scene "before you send": this week's draft orders checked against a synthetic 12-week
 * history and the menu. Pass "item=quantity[:unit]" to change the draft, e.g. milk=5000 basil=0 wurstel=5:KG.
 *   npx tsx packages/agent/src/review-cli.ts
 */
import { Unit } from './contract.js';
import { DEMO_MENU, expectedWeek, reviewWeek, syntheticHistory, type WeekOrder } from './history.js';

const history = syntheticHistory(7, 12, '2026-11-16'); // synthetic: the dataset has no order history
let week: WeekOrder[] = expectedWeek(history);
// default draft: the classic slips, an extra zero on the milk and the basil forgotten
const changes = process.argv.length > 2 ? process.argv.slice(2) : ['milk=5000', 'basil=0'];
for (const change of changes) {
  const [item, value = ''] = change.split('=');
  const [amount, unit] = value.split(':');
  const quantity = Number(amount);
  if (!item || !Number.isFinite(quantity) || quantity < 0) throw new Error(`Expected item=quantity[:unit], got "${change}"`);
  const known = week.some((o) => o.item === item);
  if (quantity === 0) week = week.filter((o) => o.item !== item);
  else if (known) week = week.map((o) => (o.item === item ? { ...o, quantity, ...(unit ? { unit: Unit.parse(unit) } : {}) } : o));
  else if (unit) week = [...week, { item, quantity, unit: Unit.parse(unit) }];
  else throw new Error(`"${item}" is not in this week's draft: add it as ${item}=${quantity}:KG (or L, ST)`);
}

console.log(`Menu: ${DEMO_MENU.map((d) => d.name).join(', ')}`);
console.log(`This week's draft: ${week.map((o) => `${o.item} ${o.quantity} ${o.unit}`).join(', ')}\n`);
const findings = reviewWeek(history, DEMO_MENU, week);
if (!findings.length) console.log('Nothing to ask: nothing forgotten, no unusual quantity.');
findings.forEach((f, i) => console.log(`${i + 1}. [${f.kind}] ${f.message}`));
