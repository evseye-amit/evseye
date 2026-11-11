import { describe, expect, it, vi } from 'vitest';
// Seed modules are shared JavaScript entry points and have no runtime side effects on import.
// @ts-expect-error The .mjs seed is executed directly by Node and does not ship TypeScript declarations.
import { seedYogmayaExchangePolicy, yogmayaExchangePolicy } from '../../prisma/client/yogmaya/exchange-policy.mjs';

describe('Yogmaya exchange policy seed', () => {
  it('creates a Yogmaya-only enabled policy and preserves existing commercial settings on rerun', async () => {
    const existing = { clientId: 'yogmaya-id', minimumDaysOnVehicle: 3, exchangeFeeAmount: '25.00', exchangeAllowed: false };
    let stored: Record<string, unknown> | undefined;
    const prisma = { client: { findUnique: vi.fn().mockResolvedValue({ id: 'yogmaya-id' }) }, clientExchangePolicy: { upsert: vi.fn(async (args) => { stored = stored ? { ...stored, ...args.update } : { ...args.create }; return stored; }) } };
    expect(await seedYogmayaExchangePolicy(prisma)).toMatchObject({ clientId: 'yogmaya-id', ...yogmayaExchangePolicy });
    stored = existing;
    expect(await seedYogmayaExchangePolicy(prisma)).toEqual({ ...existing, exchangeAllowed: true });
    expect(prisma.client.findUnique).toHaveBeenCalledWith({ where: { slug: 'yogmaya' }, select: { id: true } });
    expect(prisma.clientExchangePolicy.upsert).toHaveBeenLastCalledWith({ where: { clientId: 'yogmaya-id' }, create: { clientId: 'yogmaya-id', ...yogmayaExchangePolicy }, update: { exchangeAllowed: true } });
  });
  it('does not create a policy if Yogmaya is missing', async () => {
    const prisma = { client: { findUnique: vi.fn().mockResolvedValue(null) }, clientExchangePolicy: { upsert: vi.fn() } };
    await expect(seedYogmayaExchangePolicy(prisma)).rejects.toThrow('requires the yogmaya client');
    expect(prisma.clientExchangePolicy.upsert).not.toHaveBeenCalled();
  });
});
