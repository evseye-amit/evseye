export interface ReadinessDatabase {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, any>[] }>;
}
export interface ReadinessReport {
  environment: string;
  checks: Array<{ name: string; severity: string; count: number }>;
  status: 'BLOCKED' | 'DATABASE_CHECKS_PASSED_REQUIRES_ACCEPTANCE';
}
export function notificationReadiness(
  db: ReadinessDatabase,
  environment: string,
): Promise<ReadinessReport>;
export function main(): Promise<number>;
