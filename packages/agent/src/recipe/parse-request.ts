/**
 * Deterministic parsing of the chef's sentence: servings, meal, delivery date
 * and the remaining dish text. No LLM here, so numbers are never hallucinated.
 */

export interface ParsedRequest {
  dishText: string;
  servings: number | null;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'event' | null;
  neededBy: string | null;
  /** Human-readable notes on what was inferred. */
  notes: string[];
}

const SERVINGS_RE =
  /(?:(?:per|for|x)\s*)?(\d{1,4})\s*(?:persone|persona|people|persons|person|pax|coperti|covers|guests|ospiti|porzioni|portions|servings|henkeä|hlö)\b/i;
const FOR_N_RE = /\b(?:per|for)\s+(\d{1,4})\b/i;

const MEALS: Array<[RegExp, ParsedRequest['meal']]> = [
  [/\b(dinner|cena|illallinen)\b/i, 'dinner'],
  [/\b(lunch|pranzo|lounas)\b/i, 'lunch'],
  [/\b(breakfast|colazione|aamiainen)\b/i, 'breakfast'],
  [/\b(event|evento|banquet|buffet|party|festa)\b/i, 'event'],
];

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(sunday|domenica)\b/i, 0],
  [/\b(monday|luned[iì])\b/i, 1],
  [/\b(tuesday|marted[iì])\b/i, 2],
  [/\b(wednesday|mercoled[iì])\b/i, 3],
  [/\b(thursday|gioved[iì])\b/i, 4],
  [/\b(friday|venerd[iì])\b/i, 5],
  [/\b(saturday|sabato)\b/i, 6],
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * @param text  chef sentence, e.g. "Dinner, spaghetti al pesto per 10 persone"
 * @param today reference date (UTC), injectable for tests
 */
export function parseChefRequest(text: string, today: Date = new Date()): ParsedRequest {
  const notes: string[] = [];
  let rest = text;

  // servings
  let servings: number | null = null;
  const m = rest.match(SERVINGS_RE) ?? rest.match(FOR_N_RE);
  if (m) {
    servings = Number(m[1]);
    rest = rest.replace(m[0], ' ');
  }

  // meal
  let meal: ParsedRequest['meal'] = null;
  for (const [re, value] of MEALS) {
    const mm = rest.match(re);
    if (mm) {
      meal = value;
      rest = rest.replace(mm[0], ' ');
      break;
    }
  }

  // date: explicit ISO, today/tomorrow, or weekday
  let neededBy: string | null = null;
  const iso = rest.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) {
    neededBy = iso[1]!;
    rest = rest.replace(iso[0], ' ');
  } else if (/\b(tomorrow|domani|huomenna)\b/i.test(rest)) {
    neededBy = isoDate(addDays(today, 1));
    rest = rest.replace(/\b(tomorrow|domani|huomenna)\b/i, ' ');
    notes.push(`"tomorrow" read as ${neededBy}`);
  } else if (/\b(today|oggi|tänään)\b/i.test(rest)) {
    neededBy = isoDate(today);
    rest = rest.replace(/\b(today|oggi|tänään)\b/i, ' ');
    notes.push(`"today" read as ${neededBy}`);
  } else {
    for (const [re, dow] of WEEKDAYS) {
      const wm = rest.match(re);
      if (wm) {
        const diff = (dow - today.getUTCDay() + 7) % 7 || 7;
        neededBy = isoDate(addDays(today, diff));
        rest = rest.replace(wm[0], ' ');
        notes.push(`"${wm[0]}" read as ${neededBy}`);
        break;
      }
    }
  }
  rest = rest.replace(/\b(by|entro|for|per|on|il|next|prossimo)\b\s*$/i, ' ');

  const dishText = rest
    .replace(/[,;:.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { dishText, servings, meal, neededBy, notes };
}
