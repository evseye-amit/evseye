import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistryService } from '../../../src/kyc/verification/provider-registry.service.js';

const sandbox = { code: 'SANDBOX', acceptsCredential: (_environment: string, reference: string) => reference === 'env:KYC_SANDBOX_TEST', supports: vi.fn().mockReturnValue(true), health: vi.fn().mockResolvedValue('AVAILABLE') };

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

describe('provider environment and credential isolation', () => {
  const capability = { isSupported: true, isEnabled: true };
  it('selects production providers using the generic routing environment', async () => {
    const adapter = { ...sandbox, acceptsCredential: (environment: string, reference: string) =>
      environment === 'PRODUCTION' && reference === 'env:KYC_SANDBOX_PRODUCTION' };
    const prisma = { kycProviderConfig: { findMany: vi.fn().mockResolvedValue([
      { id: 'production', code: 'SANDBOX', environment: 'PRODUCTION', capabilities: [capability] }]) },
      kycProviderCredential: { findFirst: vi.fn().mockResolvedValue({ secretReference: 'env:KYC_SANDBOX_PRODUCTION' }) } };
    const settings = { get: (key: string) => key === 'KYC_ENVIRONMENT' ? 'PRODUCTION' : 'TEST' };
    const registry = new ProviderRegistryService(prisma as never, adapter as never, settings as never);
    expect(await registry.eligible('client', 'PAN_VERIFICATION')).toHaveLength(1);
    expect(prisma.kycProviderConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ environment: 'PRODUCTION' }) }));
  });

  it('rejects unresolved client credentials for new and pinned requests', async () => {
    const row = { id: 'sandbox', code: 'SANDBOX', environment: 'TEST', isActive: true, status: 'ACTIVE', capabilities: [capability] };
    const prisma = { kycProviderConfig: { findMany: vi.fn().mockResolvedValue([row]), findUnique: vi.fn().mockResolvedValue(row) },
      kycProviderCredential: { findFirst: vi.fn().mockResolvedValue({ secretReference: 'unresolved-tenant-account' }) } };
    const registry = new ProviderRegistryService(prisma as never, sandbox as never);
    expect(await registry.eligible('client', 'PAN_VERIFICATION')).toEqual([]);
    await expect(registry.pinned('client', 'PAN_VERIFICATION', row.id)).rejects.toThrow('KYC_PROVIDER_UNAVAILABLE');
  });

  it('uses a second adapter credential policy without Sandbox coupling', async () => {
    const prisma = { kycProviderConfig: { findMany: vi.fn().mockResolvedValue([
      { id: 'other', code: 'CASHFREE', environment: 'TEST', capabilities: [capability] }]) },
      kycProviderCredential: { findFirst: vi.fn().mockResolvedValue({ secretReference: 'other-account' }) } };
    const registry = new ProviderRegistryService(prisma as never, sandbox as never);
    registry.register({ ...sandbox, code: 'CASHFREE', acceptsCredential: (_environment: string, reference: string) =>
      reference === 'other-account' } as never);
    expect((await registry.eligible('client', 'PAN_VERIFICATION'))[0].config.code).toBe('CASHFREE');
  });

  it('rejects a pinned provider from a different environment', async () => {
    const prisma = { kycProviderConfig: { findUnique: vi.fn().mockResolvedValue({
      id: 'production', code: 'SANDBOX', environment: 'PRODUCTION', isActive: true, status: 'ACTIVE' }) } };
    await expect(new ProviderRegistryService(prisma as never, sandbox as never)
      .pinned('client', 'AADHAAR_OTP', 'production')).rejects.toThrow('KYC_PROVIDER_UNAVAILABLE');
  });
});
