import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { billingLocalDate, nextBillingBoundary, proratedAmount, resolveCommercialSegments, taxForAmount } from './billing-cycle.js';

const d = (value: string) => new Date(value);
const version = (id: string, from: string, to: string | null, amount: string, billingStartAt: string | null = null) => ({ id, vehicleId: `vehicle-${id}`, pricingHash: id, amendmentId: null, effectiveFrom: d(from), effectiveTo: to ? d(to) : null, billingStartAt: billingStartAt ? d(billingStartAt) : null, recurringAmount: new Prisma.Decimal(amount), pricingSnapshot: {} });

describe('Phase 6 billing boundaries and frozen versions', () => {
  it('uses timezone-local calendar boundaries and retains monthly anchor', () => {
    const start = d('2026-01-30T18:30:00Z');
    const feb = nextBillingBoundary(start, 'MONTHLY', 'Asia/Kolkata', null, start);
    const march = nextBillingBoundary(feb, 'MONTHLY', 'Asia/Kolkata', null, start);
    expect(feb.toISOString()).toBe('2026-02-27T18:30:00.000Z');
    expect(march.toISOString()).toBe('2026-03-30T18:30:00.000Z');
    expect(billingLocalDate(start, 'Asia/Kolkata').toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
  it('splits versions at an exchange', () => {
    const start = d('2026-10-01T00:00:00Z'), mid = d('2026-10-05T00:00:00Z'), end = d('2026-10-08T00:00:00Z');
    const segments = resolveCommercialSegments([version('v1', start.toISOString(), mid.toISOString(), '1400'), version('v2', mid.toISOString(), null, '1750')], start, end);
    expect(segments.map(s => s.versionId)).toEqual(['v1', 'v2']);
    expect(proratedAmount(segments[0].amount, segments[0].start, segments[0].end, start, end).toFixed(2)).toBe('800.00');
    expect(proratedAmount(segments[1].amount, segments[1].start, segments[1].end, start, end).toFixed(2)).toBe('750.00');
  });
  it('continues old billing terms until delayed replacement billing', () => {
    const start = d('2026-10-01T00:00:00Z'), end = d('2026-10-08T00:00:00Z');
    const segments = resolveCommercialSegments([version('v1', start.toISOString(), '2026-10-05T00:00:00Z', '1400'), version('v2', '2026-10-05T00:00:00Z', null, '1750', end.toISOString())], start, end);
    expect(segments).toHaveLength(1);
    expect(segments[0].amount.toFixed(2)).toBe('1400.00');
  });
  it('rejects a commercial history gap', () => {
    expect(() => resolveCommercialSegments([version('v1', '2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z', '1400')], d('2026-10-01T00:00:00Z'), d('2026-10-08T00:00:00Z'))).toThrow('COMMERCIAL_VERSION_NOT_FOUND_FOR_PERIOD');
  });
  it('calculates configured GST components with Decimal rounding', () => {
    const result = taxForAmount(new Prisma.Decimal('100'), { taxCode: 'GST', cgstRate: new Prisma.Decimal('9'), sgstRate: new Prisma.Decimal('9'), igstRate: new Prisma.Decimal('0') });
    expect([result.cgst, result.sgst, result.igst, result.total.toFixed(2)]).toEqual(['9.00', '9.00', '0.00', '18.00']);
  });
});
