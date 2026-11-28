import { describe, expect, it, vi } from 'vitest';
// Operational scripts are tested separately from Nest runtime.
import { notificationReadiness } from '../../scripts/notification-readiness.mjs';
describe('read-only notification readiness report', () => {
  it('blocks missing migrations and always rolls back the read-only transaction', async () => {
    const db = { query: vi.fn(async (_sql: string) => ({ rows: [] })) };
    const result = await notificationReadiness(db, 'prod');
    expect(result.status).toBe('BLOCKED');
    expect(result.checks[0].count).toBe(7);
    expect(db.query.mock.calls[0][0]).toContain('READ ONLY');
    expect(db.query.mock.calls.at(-1)![0]).toBe('ROLLBACK');
  });
  it('rolls back on schema or query errors instead of claiming readiness', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('migration_name')) throw new Error('missing table');
        return { rows: [] };
      }),
    };
    await expect(notificationReadiness(db, 'prod')).rejects.toThrow(
      'missing table',
    );
    expect(db.query.mock.calls.at(-1)![0]).toBe('ROLLBACK');
  });
});
