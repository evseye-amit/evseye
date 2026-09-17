import { describe, expect, it, vi } from 'vitest';
import { ClientDomainController } from './client-domain.controller.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
const actor: AuthUser = { id: 'admin', clientId: null, roles: ['SUPER_ADMIN'] };
function setup() {
  const tx = {
    clientDomain: {
      create: vi
        .fn()
        .mockResolvedValue({ id: 'domain', type: 'EVSEYE_SUBDOMAIN' }),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'domain' }),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue({ slug: 'acme' }) },
    clientDomain: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
  const resolver = {
    genericHosts: () => ['app.example.com'],
    baseDomains: () => ['example.com'],
  };
  return {
    controller: new ClientDomainController(prisma as never, resolver as never),
    tx,
    prisma,
  };
}
describe('Super Admin domain changes', () => {
  it('prevents assigning another client platform subdomain', async () => {
    const { controller, tx } = setup();
    await expect(
      controller.create('acme', { hostname: 'blue.example.com' }, actor),
    ).rejects.toThrow('own subdomain');
    expect(tx.clientDomain.create).not.toHaveBeenCalled();
  });
  it('records domain creation with its actor in the same transaction', async () => {
    const { controller, tx } = setup();
    await controller.create('acme', { hostname: 'acme.example.com' }, actor);
    expect(tx.clientDomain.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: 'acme', isVerified: true }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin',
        action: 'CLIENT_DOMAIN_CREATED',
      }),
    });
  });
  it('never automatically verifies a custom domain', async () => {
    const { controller, tx } = setup();
    await controller.create('acme', { hostname: 'fleet.customer.com' }, actor);
    expect(tx.clientDomain.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isVerified: false,
        type: 'CUSTOM_DOMAIN',
      }),
    });
  });
  it('does not hide database outages as duplicate hostname errors', async () => {
    const { controller, tx } = setup();
    tx.clientDomain.create.mockRejectedValue(new Error('database unavailable'));
    await expect(
      controller.create('acme', { hostname: 'acme.example.com' }, actor),
    ).rejects.toThrow('database unavailable');
  });
  it('does not remove a domain belonging to another client', async () => {
    const { controller, tx } = setup();
    await expect(
      controller.remove('acme', 'blue-domain', actor),
    ).rejects.toThrow('Domain not found');
    expect(tx.clientDomain.findFirst).toHaveBeenCalledWith({
      where: { id: 'blue-domain', clientId: 'acme' },
    });
    expect(tx.clientDomain.delete).not.toHaveBeenCalled();
  });
});
