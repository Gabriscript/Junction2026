import { describe, expect, it } from 'vitest';
import { blockedOrder } from '@junction/shared/fixtures';
import { reasonBadge } from './reason.js';

describe('reasonBadge', () => {
  it('maps severity to tone using the shared contract', () => {
    expect(reasonBadge('ALLERGEN_CONFLICT').tone).toBe('danger');
    expect(reasonBadge('UNVERIFIED_STOCK').tone).toBe('warning');
    expect(blockedOrder.decision.reasonCodes.map((c) => reasonBadge(c).label)).toContain('Allergen conflict');
  });
});
