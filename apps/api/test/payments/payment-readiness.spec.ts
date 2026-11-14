import { describe, expect, it, vi } from 'vitest';
import { inspectPaymentReadiness } from '../../scripts/payment-readiness.js';

describe('read-only payment release inventory', () => {
  it('does not require Cashfree client configuration for a completed deployment', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: [{ present: true, count: sql.includes('COUNT(DISTINCT migration_name)') ? 8 : 0 }] }));
    expect(await inspectPaymentReadiness({ query } as never, 'TEST')).toMatchObject({ status: 'LOCAL_CHECKS_CLEAR', migrationRecorded: true });
  });
  it('does not imply readiness when the merchant-version migration is absent', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: [{ present: !sql.includes('_prisma_migrations'), count: 0 }] }));
    const report = await inspectPaymentReadiness({ query } as never, 'TEST');
    expect(report.status).toBe('REVIEW_REQUIRED');
    expect(report.migrationRecorded).toBe(false);
    expect(query.mock.calls[0][0]).toBe('BEGIN READ ONLY');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.every(([sql]) => !/^(UPDATE|INSERT|DELETE|ALTER|CREATE) /i.test(sql))).toBe(true);
  });
  it('reports a missing schema without querying unavailable payment tables', async () => {
    const query = vi.fn(async () => ({ rows: [{ present: false }] }));
    expect(await inspectPaymentReadiness({ query } as never, 'TEST')).toMatchObject({ status: 'BLOCKED', missingTables: expect.arrayContaining(['PaymentProviderConfigurationVersion']) });
  });
  it('blocks release when wallet AutoPay tables are missing', async () => {
    const query = vi.fn(async (_sql: string, values?: string[]) => ({ rows: [{ present: !values?.[0]?.includes('WalletAutoRecharge') }] }));
    expect(await inspectPaymentReadiness({ query } as never, 'TEST')).toMatchObject({ status: 'BLOCKED', missingTables: ['WalletAutoRechargePolicy', 'WalletAutoRechargePreference', 'WalletAutoRecharge'] });
  });
  it('rolls back a failed inventory and rejects an implicit environment', async () => {
    const query = vi.fn(async (sql: string) => { if (sql.startsWith('SELECT')) throw new Error('read failed'); return { rows: [] }; });
    await expect(inspectPaymentReadiness({ query } as never, 'TEST')).rejects.toThrow('read failed');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    query.mockClear();
    await expect(inspectPaymentReadiness({ query } as never, 'OTHER' as never)).rejects.toThrow('explicitly');
    expect(query).not.toHaveBeenCalled();
  });
});
