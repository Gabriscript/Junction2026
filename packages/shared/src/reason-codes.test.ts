import { describe, expect, it } from 'vitest';
import { REASON_CODES, REASON_CODE_INFO, ReasonCodeSchema, decisionStatusFor } from './reason-codes.js';

describe('reason codes', () => {
  it('has the 14 codes from PLAN §6 with copy for each', () => {
    expect(REASON_CODES).toHaveLength(14);
    for (const code of REASON_CODES) {
      expect(REASON_CODE_INFO[code].title.length).toBeGreaterThan(0);
      expect(REASON_CODE_INFO[code].description.length).toBeGreaterThan(0);
    }
  });
  it('ALLERGEN_CONFLICT is always blocked', () => {
    expect(REASON_CODE_INFO.ALLERGEN_CONFLICT.severity).toBe('blocked');
    expect(decisionStatusFor(['OVER_AUTO_LIMIT', 'ALLERGEN_CONFLICT'])).toBe('blocked');
  });
  it('derives the decision status', () => {
    expect(decisionStatusFor([])).toBe('auto_approved');
    expect(decisionStatusFor(['UNVERIFIED_STOCK', 'OVER_BUDGET'])).toBe('needs_approval');
    expect(decisionStatusFor(['OFFER_EXPIRED'])).toBe('blocked');
  });
  it('rejects unknown codes', () => {
    expect(ReasonCodeSchema.safeParse('NOPE').success).toBe(false);
  });
});
