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

type Tone = 'ok' | 'warn' | 'stop';

const STATUS: Record<OrderStatus | DecisionStatus, { label: string; tone: Tone }> = {
  auto_approved: { label: 'Auto-approved', tone: 'ok' },
  approved: { label: 'Approved', tone: 'ok' },
  pending_approval: { label: 'Needs approval', tone: 'warn' },
  needs_approval: { label: 'Needs approval', tone: 'warn' },
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
            <div>
              <strong>{reason.title}</strong>
              <code>{code}</code>
              <p>{reason.description}</p>
            </div>
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
