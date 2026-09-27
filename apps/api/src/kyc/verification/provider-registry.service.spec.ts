import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistryService } from './provider-registry.service.js';

const sandbox = { code: 'SANDBOX', supports: vi.fn().mockReturnValue(true), health: vi.fn().mockResolvedValue('AVAILABLE') };

describe('provider registry and resolver', () => {
  it('resolves only enabled, supported providers with an active credential reference', async () => {
    const config = { id: 'provider-1', code: 'SANDBOX', capabilities: [{ verificationType: 'PAN_VERIFICATION',
      timeoutMs: 10000, isSupported: true, isEnabled: true }] };
    const prisma = { kycProviderConfig: { findMany: vi.fn().mockResolvedValue([config]) },
      kycProviderCredential: { findFirst: vi.fn().mockResolvedValue({ secretReference: 'env:KYC_SANDBOX_TEST' }) } };
    const registry = new ProviderRegistryService(prisma as never, sandbox as never);
    const result = await registry.resolve('client-a', 'PAN_VERIFICATION');
    expect(result.provider).toBe(sandbox);
    expect(prisma.kycProviderConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: true, status: 'ACTIVE', environment: 'TEST' }),
    }));
    expect(prisma.kycProviderCredential.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: 'client-a', status: 'ACTIVE' }),
    }));
  });

  it('falls back to a global credential only when the client has no active credential', async () => {
    const config = { id: 'provider-1', code: 'SANDBOX', capabilities: [{ verificationType: 'PAN_VERIFICATION',
      isSupported: true, isEnabled: true }] };
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ secretReference: 'env:KYC_SANDBOX_TEST' });
    const prisma = { kycProviderConfig: { findMany: vi.fn().mockResolvedValue([config]) },
      kycProviderCredential: { findFirst } };
    const registry = new ProviderRegistryService(prisma as never, sandbox as never);
    await expect(registry.resolve('client-a', 'PAN_VERIFICATION')).resolves.toMatchObject({
      secretReference: 'env:KYC_SANDBOX_TEST',
    });
    expect(findFirst.mock.calls[0][0].where.clientId).toBe('client-a');
    expect(findFirst.mock.calls[1][0].where.clientId).toBeNull();
  });

  it('does not query a global credential when a client credential exists', async () => {
    const config = { id: 'provider-1', code: 'SANDBOX', capabilities: [{ verificationType: 'PAN_VERIFICATION',
      isSupported: true, isEnabled: true }] };
    const findFirst = vi.fn().mockResolvedValue({ secretReference: 'env:KYC_SANDBOX_TEST' });
    const registry = new ProviderRegistryService({ kycProviderConfig: { findMany: vi.fn().mockResolvedValue([config]) },
      kycProviderCredential: { findFirst } } as never, sandbox as never);
    await registry.resolve('client-a', 'PAN_VERIFICATION');
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where.clientId).toBe('client-a');
  });

  it('uses registered adapter health without assuming a vendor code', async () => {
    const registry = new ProviderRegistryService({} as never, sandbox as never);
    expect(await registry.health('SANDBOX')).toBe('AVAILABLE');
    expect(await registry.health('CASHFREE')).toBe('UNAVAILABLE');
    const second = { code: 'CASHFREE', health: vi.fn().mockResolvedValue('AVAILABLE') };
    registry.register(second as never);
    expect(await registry.health('CASHFREE')).toBe('AVAILABLE');
  });

  it('fails closed when no provider is enabled', async () => {
    const prisma = { kycProviderConfig: { findMany: vi.fn().mockResolvedValue([]) } };
    const registry = new ProviderRegistryService(prisma as never, sandbox as never);
    await expect(registry.resolve('client-a', 'PAN_VERIFICATION')).rejects.toThrow('KYC_PROVIDER_UNAVAILABLE');
  });
});
