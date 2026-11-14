// UI-only additions on top of @junction/shared. Everything else comes from the shared contract.
import type { AuditVisibility, EurAmount, Order } from '@junction/shared';

/** Which audit view the user picked. The gateway filters events by `visibility`. */
export type AuditScope = AuditVisibility;

export interface Alternative {
  tier: 'good' | 'better' | 'best';
  title: string;
  /** EUR excluding VAT, same convention as shared money fields. */
  total: EurAmount;
  why: string;
  /** true for the option the agent put in the cart. */
  chosen: boolean;
}

export interface TraceStep {
  at: string;
  /** Gateway tool the agent called, if any. */
  tool?: string;
  text: string;
}

// shortcut: agentName, alternatives and trace are not in the shared Order yet; only the mock fills them,
// the screens hide them when absent. Drop this once shared carries them (or the UI reads `explain`).
export type UiOrder = Order & { agentName?: string; alternatives?: Alternative[]; trace?: TraceStep[] };
