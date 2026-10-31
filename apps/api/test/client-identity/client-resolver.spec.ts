import { describe, expect, it, vi } from 'vitest';
import { ClientResolverService } from '../../src/client-identity/client-resolver.service.js';

function setup(overrides: Record<string, unknown> = {}) {
  const prisma = {
    clientDomain: { findUnique: vi.fn().mockResolvedValue(null) },
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }), findFirst: vi.fn().mockResolvedValue({ id: 'client-1', companyCode: 'acme', slug: 'acme' }) },
  };
  const config = { get: (key: string) => ({ APP_BASE_DOMAINS: 'example.com', APP_GENERIC_HOSTS: 'app.example.com,localhost', CLIENT_PROXY_SECRET: 'secret', ...overrides })[key] };
  return { service: new ClientResolverService(prisma as never, config as never), prisma };
}

describe('ClientResolverService hostname contract', () => {
  it('treats generic hosts as unscoped', async () => {
    const { service } = setup();
    await expect(service.resolve('app.example.com')).resolves.toBeNull();
  });

  it('resolves a configured client subdomain', async () => {
    const { service } = setup();
    await expect(service.resolve('acme.example.com')).resolves.toMatchObject({ clientId: 'client-1', hostname: 'acme.example.com' });
  });

  it('rejects an unavailable custom domain', async () => {
    const { service, prisma } = setup();
    prisma.clientDomain.findUnique.mockResolvedValue({ clientId: 'client-1', isVerified: false });
    await expect(service.resolve('fleet.customer.com')).rejects.toMatchObject({ response: { code: 'WORKSPACE_UNAVAILABLE' } });
  });

  it('rejects mismatched request origin and host contexts', async () => {
    const { service, prisma } = setup();
    prisma.clientDomain.findUnique.mockImplementation(async ({ where }: { where: { hostname: string } }) =>
      where.hostname === 'acme.example.com' ? { clientId: 'client-1', isVerified: true } : { clientId: 'client-2', isVerified: true });
    prisma.client.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, companyCode: where.id, slug: where.id }));
    await expect(service.fromRequest({ headers: { host: 'acme.example.com', origin: 'https://other.example.com' } } as never)).rejects.toThrow('Workspace mismatch');
  });
});
