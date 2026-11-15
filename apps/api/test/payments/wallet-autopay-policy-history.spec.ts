import { expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { WalletAutoRechargeService } from '../../src/payments/wallet-auto-recharge.service.js';
function fixture() {
  const tx = { $queryRaw: vi.fn(), walletAutoRechargePolicy: {
    findUnique: vi.fn().mockResolvedValue({ enabled: true, threshold: new Prisma.Decimal(550), rechargeAmount: new Prisma.Decimal(750), revision: 1 }),
    upsert: vi.fn().mockImplementation(async ({ update }) => update),
  }, auditLog: { create: vi.fn(), findMany: vi.fn() } };
  const db = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  return { tx, service: new WalletAutoRechargeService(db as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any) };
}
const input = { enabled: true, threshold: '550.00', rechargeAmount: '750.00', revision: 1 };
it('records before/after values and authenticated actor in the policy transaction', async () => {
  const { tx, service } = fixture();
  expect((await service.setPolicy('client', 'admin', { ...input, threshold: '600.00' })).revision).toBe(2);
  expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    clientId: 'client', actorId: 'admin', previousData: input,
    newData: { ...input, threshold: '600.00', revision: 2 },
  }) });
});
it('does not write unchanged settings or audit entries', async () => {
  const { tx, service } = fixture();
  await service.setPolicy('client', 'admin', input);
  expect(tx.walletAutoRechargePolicy.upsert).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
it('audits a toggle without changing consent revision', async () => {
  const { tx, service } = fixture();
  expect((await service.setPolicy('client', 'admin', { ...input, enabled: false })).revision).toBe(1);
  expect(tx.auditLog.create).toHaveBeenCalledOnce();
});
it('rejects stale revisions without writing audit entries', async () => {
  const { tx, service } = fixture();
  await expect(service.setPolicy('client', 'admin', { ...input, revision: 0 })).rejects.toThrow('Policy changed');
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
it('scopes history to the client and serializes legacy records', async () => {
  const { tx, service } = fixture();
  tx.auditLog.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ id: BigInt(i + 1), actor: null, actorId: null, previousData: null, newData: null, createdAt: new Date() })));
  const result = await service.policyHistory('client-a', 2);
  expect(tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { clientId: 'client-a', action: 'WALLET_AUTOPAY_POLICY_UPDATED', entityType: 'WalletAutoRechargePolicy', entityId: 'client-a' }, skip: 20, take: 21,
  }));
  expect(result.items).toHaveLength(20);
  expect(result.hasMore).toBe(true);
  expect(result.items[0]).toMatchObject({ id: '1', actorName: null, previousData: null });
  expect(() => JSON.stringify(result)).not.toThrow();
});
