import { REASON_CODE_INFO, type ReasonCode } from '@junction/shared';

export interface ReasonBadge {
  code: ReasonCode;
  label: string;
  tone: 'warning' | 'danger';
  help: string;
}

/** Badge data for a reason code: `blocked` codes render as danger, the rest as warning. */
export function reasonBadge(code: ReasonCode): ReasonBadge {
  const info = REASON_CODE_INFO[code];
  return {
    code,
    label: info.title,
    tone: info.severity === 'blocked' ? 'danger' : 'warning',
    help: info.description,
  };
}
