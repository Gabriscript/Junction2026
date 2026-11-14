// The demo kitchen behind the chat and the orders dashboard. History and menu are synthetic
// (seeded, the same as review-cli.ts): the dataset has no order history.
// shortcut: imported straight from the agent's source (pure module, no Node imports). The real flow
// would get these from the agent through the gateway; there is no endpoint for that yet.
import { DEMO_MENU, expectedWeek, parLevels, reviewWeek, syntheticHistory, type Finding, type WeekOrder } from '../../agent/src/history';
import type { Unit } from '../../agent/src/contract';

export { DEMO_MENU, expectedWeek, parLevels, reviewWeek, type Finding, type Unit, type WeekOrder };

export const KITCHEN = 'Hotel Aurora kitchen';
/** ISO 8601 week number, the way Finland counts weeks: week 1 holds the year's first Thursday. */
export function isoWeek(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // the Thursday of that week
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round((d.getTime() - jan4.getTime()) / 86_400_000 / 7 - 3 / 7 + ((jan4.getUTCDay() + 6) % 7) / 7);
}

export const THIS_MONDAY = '2026-11-16';
/** This year's orders so far, ISO weeks 1 to 46 of 2026 (synthetic). */
export const yearHistory = syntheticHistory(7, isoWeek(THIS_MONDAY) - 1, THIS_MONDAY);
/** What the review and the par levels look at: the last 12 weeks. */
export const history = yearHistory.slice(-12);

const UNIT_WORDS: Record<string, Unit> = {
  l: 'L', lt: 'L', ltr: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L',
  kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  st: 'ST', pc: 'ST', pcs: 'ST', piece: 'ST', pieces: 'ST',
};
const UNIT = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|');
// "1,000" and "1 000" are thousands, "1,5" is a decimal
const NUMBER = String.raw`\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?`;
const QTY_FIRST = new RegExp(String.raw`^(${NUMBER})\s*(${UNIT})\.?\s+(?:of\s+)?(.+)$`, 'i');
const ITEM_FIRST = new RegExp(String.raw`^(.+?)\s*[:=]?\s+(${NUMBER})\s*(${UNIT})\.?$`, 'i');
const USUAL = /\b(usual|regular|weekly order|same as (?:last|every) week)\b/i;

const toNumber = (raw: string) => Number(/^\d{1,3}(?:[ ,]\d{3})+/.test(raw) ? raw.replace(/[ ,]/g, '') : raw.replace(',', '.'));
const cleanItem = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/\b(by|for|before|on)\s+(mon|tue|wed|thu|fri|sat|sun)\w*\b.*$/, '') // "by Monday"
    .replace(/[.!?]+$/, '')
    .replace(/\s+to$/, '') // "change milk to 500 L"
    .trim();

export interface ParsedMessage {
  /** Lines read from the message, in order; repeated items are left for reviewWeek to sum. */
  lines: WeekOrder[];
  /** The message asks for the usual week: start from the history, the lines override it. */
  usual: boolean;
  /** Items the message leaves out on purpose: "no basil", "without salt". */
  removed: string[];
  /** Parts with no readable quantity and unit, shown back to the chef. */
  unread: string[];
}

/** Reads "500 L milk, 40 kg mozzarella and basil 1 kg" into order lines. No LLM: what it cannot read, it says. */
export function parseMessage(text: string): ParsedMessage {
  const usual = USUAL.test(text);
  const lines: WeekOrder[] = [];
  const unread: string[] = [];
  const removed: string[] = [];
  for (const raw of text.split(/\n|;|,(?!\d)|\band\b|\bplus\b/i)) {
    const part = raw.trim().replace(/^(but|also|please|with|then|make|change|set|add|order|i need|we need|need)\s+/i, '');
    if (!part) continue;
    const a = QTY_FIRST.exec(part);
    const b = a ? null : ITEM_FIRST.exec(part);
    const [quantity, unit, item] = a ? [a[1]!, a[2]!, a[3]!] : b ? [b[2]!, b[3]!, b[1]!] : [];
    const name = item ? cleanItem(item) : '';
    // a removal only where no quantity was read: "40 kg mozzarella no lactose" stays a line
    const skip = name ? null : /(?:^|\s)(?:no|without|skip)\s+(.+)$/i.exec(part);
    if (quantity && unit && name) lines.push({ item: name, quantity: toNumber(quantity), unit: UNIT_WORDS[unit.toLowerCase()]! });
    else if (skip) removed.push(cleanItem(skip[1]!));
    else if (!(usual && USUAL.test(part))) unread.push(part);
  }
  return { lines, usual, removed, unread };
}

/** The draft the chef is asked to confirm: the usual week if asked for, with the message's lines on top. */
export function draftFrom(parsed: ParsedMessage): WeekOrder[] {
  return mergeLines(parsed.usual ? expectedWeek(history) : [], parsed.lines, parsed.removed);
}

/** Changes lines in place ("milk 500 L" fixes the milk row where it is), drops removed items, appends new ones. */
export function mergeLines(rows: WeekOrder[], lines: WeekOrder[], removed: string[] = []): WeekOrder[] {
  const latest = new Map(lines.map((l) => [l.item, l]));
  const kept = rows.filter((r) => !removed.includes(r.item)).map((r) => latest.get(r.item) ?? r);
  const known = new Set(kept.map((r) => r.item));
  return [...kept, ...lines.filter((l) => !known.has(l.item) && latest.get(l.item) === l)];
}
