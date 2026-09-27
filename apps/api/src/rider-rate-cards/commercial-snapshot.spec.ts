import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  parseSnapshot,
  pricingHash,
  sha256,
} from './commercial-snapshot.js';

const snapshot = {
  calculationId: 'volatile-id',
  calculatedAt: '2026-10-15T00:00:00Z',
  currency: 'INR',
  effectiveDate: '2026-10-15',
  rateCard: { id: 'card', code: 'STANDARD', versionId: 'version', version: 2 },
  rider: { id: 'rider' },
  vehicle: { id: 'vehicle', ageMonths: 14, commercialGrade: 'B' },
  rental: { finalAmount: '1400.00', period: 'WEEKLY' },
  totals: {
    recurringAmount: '1400.00',
    payableToday: '4400.00',
    refundableDepositAmount: '3000.00',
  },
  deposits: [],
  adjustments: [],
  recurringCharges: [],
  oneTimeCharges: [],
  usageCharges: [],
  includedServices: [],
};
describe('commercial snapshot integrity', () => {
  it('sorts object keys recursively and preserves array order', () => {
    expect(
      canonicalJson({ z: 1, a: { b: 2, a: 3 }, items: ['first', 'second'] }),
    ).toBe(
      canonicalJson({ items: ['first', 'second'], a: { a: 3, b: 2 }, z: 1 }),
    );
    expect(canonicalJson({ items: ['first', 'second'] })).not.toBe(
      canonicalJson({ items: ['second', 'first'] }),
    );
  });
  it('ignores calculation ID and timestamp but binds terms and prices', () => {
    const terms = sha256('Terms V3');
    const original = pricingHash('client', snapshot, terms, 'RENTAL@3');
    expect(
      pricingHash(
        'client',
        { ...snapshot, calculationId: 'other', calculatedAt: 'tomorrow' },
        terms,
        'RENTAL@3',
      ),
    ).toBe(original);
    expect(
      pricingHash(
        'client',
        { ...snapshot, rental: { ...snapshot.rental, finalAmount: '1401.00' } },
        terms,
        'RENTAL@3',
      ),
    ).not.toBe(original);
    expect(
      pricingHash('client', snapshot, sha256('Terms V4'), 'RENTAL@4'),
    ).not.toBe(original);
    expect(pricingHash('other-client', snapshot, terms, 'RENTAL@3')).not.toBe(
      original,
    );
  });
  it('rejects unsupported snapshot schema versions', () => {
    expect(() => parseSnapshot(snapshot, 2)).toThrow();
  });
});
