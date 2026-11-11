import { Prisma } from '@prisma/client';

export type OpenInvoice = {
  id: string;
  dueDate: Date;
  outstandingAmount: Prisma.Decimal;
  agreementId: string | null;
};
export type Stage = {
  stageCode: string;
  daysFromDue: number;
  displayOrder: number;
  isActive: boolean;
  actions: unknown;
  severity?: number;
};
export function localDay(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
export function daysBetween(due: Date, now: Date, timezone: string): number {
  const date = (value: string) => Date.parse(`${value}T00:00:00.000Z`);
  return Math.max(
    0,
    Math.round(
      (date(localDay(now, timezone)) - date(due.toISOString().slice(0, 10))) /
        86400000,
    ),
  );
}
export function delinquency(
  invoices: OpenInvoice[],
  now: Date,
  timezone: string,
  grace: number,
  stages: Stage[],
) {
  const today = localDay(now, timezone);
  const due = invoices.filter(
    (i) => i.dueDate.toISOString().slice(0, 10) <= today,
  );
  const overdue = due.filter(
    (i) => daysBetween(i.dueDate, now, timezone) > grace,
  );
  const oldest = due.reduce<Date | null>(
    (min, i) => (!min || i.dueDate < min ? i.dueDate : min),
    null,
  );
  const daysPastDue = oldest ? daysBetween(oldest, now, timezone) : 0;
  const stage =
    stages
      .filter((s) => s.isActive && s.daysFromDue <= daysPastDue)
      .sort(
        (a, b) =>
          b.daysFromDue - a.daysFromDue || b.displayOrder - a.displayOrder,
      )[0] ?? null;
  const totalOutstanding = invoices.reduce(
    (sum, i) => sum.plus(i.outstandingAmount),
    new Prisma.Decimal(0),
  );
  const overdueOutstanding = overdue.reduce(
    (sum, i) => sum.plus(i.outstandingAmount),
    new Prisma.Decimal(0),
  );
  const state = !invoices.length
    ? 'CURRENT'
    : !due.length
      ? 'CURRENT'
      : daysPastDue === 0
        ? 'DUE'
        : daysPastDue <= grace
          ? 'GRACE'
          : stage && (stage.severity ?? 0) >= 3
            ? 'SEVERELY_DELINQUENT'
            : stage && (stage.severity ?? 0) >= 2
              ? 'DELINQUENT'
              : 'OVERDUE';
  return {
    totalOutstanding,
    overdueOutstanding,
    oldestDueDate: oldest,
    daysPastDue,
    delinquencyState: state,
    stage,
    due,
    overdue,
  };
}
