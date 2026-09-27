import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { daysBetween, delinquency, localDay } from './collection-math.js';
const invoice = (amount: string, dueDate: string) => ({
  id: dueDate,
  dueDate: new Date(`${dueDate}T00:00:00.000Z`),
  outstandingAmount: new Prisma.Decimal(amount),
  agreementId: null,
});
const stages = [
  {
    stageCode: 'REMINDER',
    daysFromDue: 3,
    displayOrder: 1,
    isActive: true,
    actions: ['PUSH_NOTIFICATION'],
  },
  {
    stageCode: 'REVIEW',
    daysFromDue: 7,
    displayOrder: 2,
    isActive: true,
    actions: ['OPERATIONS_TASK'],
  },
];
describe('collection delinquency', () => {
  it('uses calendar days and leaves due date unchanged during grace', () => {
    const now = new Date('2026-10-02T18:30:00.000Z'); // 03 Oct IST
    expect(localDay(now, 'Asia/Kolkata')).toBe('2026-10-03');
    expect(
      daysBetween(new Date('2026-10-01T00:00:00.000Z'), now, 'Asia/Kolkata'),
    ).toBe(2);
    const result = delinquency(
      [invoice('1000', '2026-10-01')],
      now,
      'Asia/Kolkata',
      2,
      stages,
    );
    expect(result.delinquencyState).toBe('GRACE');
    expect(result.oldestDueDate?.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(result.overdueOutstanding.toString()).toBe('0');
  });
  it('chooses a configured stage and sums multiple invoice obligations', () => {
    const result = delinquency(
      [invoice('1000', '2026-10-01'), invoice('500', '2026-10-04')],
      new Date('2026-10-08T06:00:00.000Z'),
      'Asia/Kolkata',
      2,
      stages,
    );
    expect(result.totalOutstanding.toString()).toBe('1500');
    expect(result.overdueOutstanding.toString()).toBe('1500');
    expect(result.daysPastDue).toBe(7);
    expect(result.stage?.stageCode).toBe('REVIEW');
  });
  it('treats SQL date columns as calendar dates in western timezones', () => {
    const result = delinquency(
      [invoice('100', '2026-10-01')],
      new Date('2026-10-01T18:00:00.000Z'),
      'America/Los_Angeles',
      0,
      stages,
    );
    expect(result.daysPastDue).toBe(0);
    expect(result.delinquencyState).toBe('DUE');
  });
  it('excludes future invoices and deposits from overdue amounts', () => {
    const result = delinquency(
      [invoice('120', '2026-10-01'), invoice('300', '2026-11-01')],
      new Date('2026-10-03T06:00:00.000Z'),
      'Asia/Kolkata',
      1,
      stages,
    );
    expect(result.totalOutstanding.toString()).toBe('420');
    expect(result.overdueOutstanding.toString()).toBe('120');
  });
});
