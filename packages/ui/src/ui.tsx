// Small shared pieces: formatting, status badge, reason chips, live data hook.
import { useEffect, useRef, useState } from 'react';
import type { GatewayApi } from './api';
import { REASON_CODE_INFO, type DecisionStatus, type EurAmount, type OrderStatus, type ReasonCode } from '@junction/shared';
import type { UiOrder } from './contract';

const eurFormat = new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' });
/** Money travels as decimal EUR (shared convention); this is the only place it becomes "1 899,00 €". */
export const eur = (amount: EurAmount) => eurFormat.format(amount);

/** VAT rate in percent (shared convention), e.g. 13.5 -> "13,5 %". */
export const vatPercent = (rate: number) => `${rate.toLocaleString('fi-FI')} %`;

export const time = (ts: string) =>
  new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const shortHash = (hash: string) => hash.slice(0, 8);

/** Agent rationale, then the gateway's case-specific reason messages. */
export const whyText = (order: UiOrder) => [...(order.rationale?.split('\n') ?? []), ...order.decision.reasons.map((r) => r.message)].filter((t): t is string => !!t);

/**
 * The agent's reason for each substitute line. Its rationale is a header, then one reason per
 * substitute line in line order (agent.ts); if the counts differ, nothing is paired rather than mispaired.
 * shortcut: shared OrderLine has no per-line reason field; read it from there once shared adds one.
 */
export function substituteReasons(order: UiOrder): Map<string, string> {
  const substitutes = order.lines.filter((l) => l.substituteFor);
  const reasons = order.rationale?.split('\n').slice(1) ?? [];
  return reasons.length === substitutes.length ? new Map(substitutes.map((l, i) => [l.lineId, reasons[i]!])) : new Map();
}

type Tone = 'ok' | 'warn' | 'stop';

const STATUS: Record<OrderStatus | DecisionStatus, { label: string; tone: Tone }> = {
  auto_approved: { label: 'Auto-approved', tone: 'ok' },
  approved: { label: 'Approved', tone: 'ok' },
  pending_approval: { label: 'Needs your OK', tone: 'warn' },
  needs_approval: { label: 'Needs your OK', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'stop' },
  rejected: { label: 'Rejected', tone: 'stop' },
};

const ICON_PATHS: Record<Tone, string> = {
  ok: 'M4 10.5l4 4 8-9',
  warn: 'M10 3l8 14H2L10 3zm0 5v4m0 2.5v.5',
  stop: 'M10 2a8 8 0 100 16 8 8 0 000-16zM4.5 4.5l11 11',
};

export function ToneIcon({ tone }: { tone: Tone }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[tone]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// One hand-drawn line family: 24px grid, 1.75 stroke, round caps (ToneIcon is the same style at 20px).
const ICONS = {
  approvals: 'M4 13.5V18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5M4 13.5 6.5 5h11l2.5 8.5M4 13.5h4.5l1 2h5l1-2H20M9.5 9.5l2 2 3.5-3.5',
  review: 'M9 3.5h6v3H9zM8 5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H16M9 11.5h6M9 15.5h4',
  audit: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  request: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM12 8v5M9.5 10.5h5',
  shield: 'M12 3.5 5 6.5v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9v-5zM9 12l2 2 4-4',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l2.5 2.5',
  placed: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM8.5 12.5l2.5 2.5 4.5-5',
  stopped: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM6.5 6.5l11 11',
  back: 'M14.5 6 8.5 12l6 6',
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5M6 11l6-6 6 6',
  clip: 'M15.5 7.5 9 14a2 2 0 0 0 2.83 2.83l6.5-6.5a4 4 0 0 0-5.66-5.66L6.2 11.1a6 6 0 0 0 8.49 8.49L19 15.3',
  image: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5h.01',
  file: 'M7 3.5h7l4.5 4.5v12a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5zM13.5 3.5V8.5h5M9.5 13h5M9.5 16.5h5',
  orders: 'M5 19V11M10 19V5M15 19v-6M20 19V8M3.5 19.5h17',
  close: 'M7 7l10 10M17 7 7 17',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatusBadge({ status }: { status: OrderStatus | DecisionStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <span className={`badge tone-${tone}`}>
      <ToneIcon tone={tone} />
      {label}
    </span>
  );
}

export function ReasonChips({ codes }: { codes: ReasonCode[] }) {
  if (codes.length === 0) return null;
  return (
    <ul className="reasons" aria-label="Reason codes">
      {codes.map((code) => {
        const reason = REASON_CODE_INFO[code];
        const tone = reason.severity === 'blocked' ? 'stop' : 'warn';
        return (
          <li key={code} className={`reason tone-${tone}`}>
            <ToneIcon tone={tone} />
            <details>
              <summary>
                <strong>{reason.title}</strong>
              </summary>
              <p>{reason.description}</p>
              <code>{code}</code>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** Loads once, then again on every gateway event, so screens stay current without a reload. */
export function useLive<T>(api: GatewayApi, load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const loadRef = useRef(load);
  loadRef.current = load;
  const refreshRef = useRef(() => {});

  useEffect(() => {
    let latest = 0;
    let active = true;
    const refresh = () => {
      const run = ++latest;
      loadRef.current().then(
        (value) => {
          if (active && run === latest) {
            setData(value);
            setError(undefined);
          }
        },
        (err: unknown) => {
          if (active && run === latest) setError(err instanceof Error ? err.message : String(err));
        },
      );
    };
    refreshRef.current = refresh;
    refresh();
    const unsubscribe = api.subscribe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, key]);

  // refresh: for after the user's own actions, so the screen does not depend on the event stream alone.
  return { data, error, refresh: () => refreshRef.current() };
}
