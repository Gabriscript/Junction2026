// Guided demo tour (mock mode only): drives the routes and the view switch, spotlights one element per step.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface TourStep {
  title: string;
  text: string;
  /** Hash route without "#/". */
  route: string;
  view?: 'kitchen' | 'aimo';
  /** A request the tour types into the New order composer. */
  ask?: string;
  /** Send it. */
  send?: boolean;
  /** Then answer the quantity check with the usual amount, as the chef would. */
  fix?: boolean;
  /** CSS selector of the spotlit element (a data-tour hook). */
  target: string;
}

/** The one order the first three steps follow: typed, checked for a slip, then a substitute for its short line. */
const ASK = '3000 kg tomatoes, 100 L vanilla ice cream';

export const STEPS: TourStep[] = [
  { title: 'New order', text: 'Tell Mikko what you need: type, speak, or snap a note.', route: 'new', ask: ASK, target: '[data-tour="composer"]' },
  { title: 'Unusual quantity guard', text: 'A 100x slip on tomatoes: Mikko asks before anything is ordered.', route: 'new', ask: ASK, send: true, target: '[data-tour="qty-flag"]' },
  { title: 'Product running out', text: '30 kg it is. Now the ice cream in the same order is short: Mikko proposes a substitute, you accept or keep waiting.', route: 'new', ask: ASK, send: true, fix: true, target: '[data-tour="substitute"]' },
  { title: 'Autopilot', text: "Mikko learns your usual week and orders it on its rhythm. 'Ask me' keeps an item manual.", route: 'orders', target: '[data-tour="autopilot"]' },
  { title: 'More than price', text: 'Reliability and CO₂ from Valio Aimo data, not just price.', route: 'orders', target: '[data-tour="autopilot"] .pfacts' },
  { title: 'Approvals', text: 'Something is unusual, so Mikko waits for you.', route: 'queue', target: '[data-tour="approval"]' },
  { title: 'Reason chips', text: 'Partial availability, stock not verified: each reason one tap away.', route: 'queue', target: '[data-tour="approval"] .reasons' },
  { title: 'Signed price', text: 'Fixed price signed by Valio Aimo. A changed price is blocked.', route: 'queue', target: '[data-tour="approval"] .signed-note' },
  { title: 'Why Mikko chose this', text: 'Every choice explained, substitutes included.', route: 'orders/ord-1000', view: 'kitchen', target: '[data-tour="why"]' },
  { title: 'Kitchen audit trail', text: 'Every step written down in plain words, chain verified in your browser.', route: 'audit', view: 'kitchen', target: '[data-tour="chain"]' },
  { title: 'Blocked by the gateway', text: 'Valio Aimo view: an unknown agent with a forged price, blocked by the gateway.', route: 'all', target: '[data-tour="blocked"]' },
  { title: 'Tamper test', text: 'Change one record and the chain breaks. Try the button.', route: 'audit', view: 'aimo', target: '[data-tour="tamper"]' },
];

const GAP = 12;

export function Tour({ onStep, onExit }: { onStep: (step: TourStep) => void; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<{ top: number; left: number; width: number; height: number; cardTop: number; cardLeft: number; low: boolean }>();
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;

  useEffect(() => {
    onStep(step);
    setSpot(undefined);
    let seen: Element | null = null;
    // The target appears once the route has loaded its data, and moves as the page settles: follow it.
    const follow = () => {
      if (location.hash !== `#/${step.route}`) return; // the previous screen is still up: never spotlight its element
      const el = document.querySelector(step.target);
      if (!el) return;
      if (el !== seen) {
        seen = el;
        const fold = el.closest('details');
        if (fold) fold.open = true;
        el.scrollIntoView?.({ block: 'center' });
      }
      const r = el.getBoundingClientRect();
      const w = card.current?.offsetWidth ?? 352;
      const h = card.current?.offsetHeight ?? 200;
      const below = r.bottom + GAP;
      const above = r.top - GAP - h;
      const cardTop = below + h <= innerHeight - GAP ? below : above >= GAP ? above : Math.max(GAP, innerHeight - h - GAP);
      const cardLeft = Math.min(Math.max(GAP, r.left), Math.max(GAP, innerWidth - w - GAP));
      // clamped to the viewport, so a target wider than the screen (a scrolling table row) does not push the spot past it
      const left = Math.max(0, r.left - 6);
      const right = Math.min(document.documentElement.clientWidth, r.right + 6);
      const next = { top: r.top - 6, left, width: Math.max(0, right - left), height: r.height + 12, cardTop, cardLeft, low: r.top + r.height / 2 > innerHeight / 2 };
      setSpot((prev) => (prev && (Object.keys(next) as (keyof typeof next)[]).every((k) => prev[k] === next[k]) ? prev : next));
    };
    follow();
    const timer = setInterval(follow, 150);
    if (!card.current?.contains(document.activeElement)) card.current?.focus();
    return () => clearInterval(timer);
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
        return;
      }
      if (e.key !== 'Tab' || !card.current) return;
      const items = [...card.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
      const inside = card.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === items[0] || document.activeElement === card.current)) {
        e.preventDefault();
        items.at(-1)?.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === items.at(-1))) {
        e.preventDefault();
        items[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onExit]);

  const place = spot ? ({ '--tour-top': `${spot.cardTop}px`, '--tour-left': `${spot.cardLeft}px` } as CSSProperties) : undefined;

  return (
    <div className={spot ? 'tour' : 'tour tour-dim'}>
      {spot && <div className="tour-spot" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />}
      <div
        ref={card}
        className={`tour-card${spot ? ' tour-placed' : ''}${spot?.low ? ' tour-low' : ''}`}
        style={place}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
      >
        <p className="tour-count">
          Step {i + 1} of {STEPS.length}
        </p>
        <div aria-live="polite">
          <h2 id="tour-title">{step.title}</h2>
          <p id="tour-text">{step.text}</p>
        </div>
        <div className="tour-actions">
          <button type="button" className="btn quiet" onClick={onExit}>
            Exit
          </button>
          <button type="button" className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </button>
          <button type="button" className="btn primary" onClick={() => (last ? onExit() : setI(i + 1))}>
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
