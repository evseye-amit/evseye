import type { ReadinessDatabase } from './notification-readiness.mjs';
export type UpgradeSnapshot = {
  version: number;
  tables: Record<
    string,
    { columns: string[]; count: string; first: string; second: string } | null
  >;
};
export function validateRehearsalUrl(value: string): void;
export function captureUpgradeData(
  db: ReadinessDatabase,
  baseline?: UpgradeSnapshot,
): Promise<UpgradeSnapshot>;
export function compareUpgradeData(
  before: UpgradeSnapshot,
  after: UpgradeSnapshot,
): string[];
export function main(): Promise<number>;
