import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { validate } from 'class-validator';
import { ClientResolverService } from './client-resolver.service.js';
import { normalizeHostname, validClientSlug } from './hostname.js';
import { ClientBrandingService } from './client-branding.service.js';
import { ClientBrandingController } from './client-branding.controller.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { UpdateBrandingDto } from './branding.dto.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';

function setup() {
  const config = new ConfigService({
    APP_BASE_DOMAINS: 'evseye.com,localhost',
    APP_GENERIC_HOSTS: 'localhost,127.0.0.1',
    CLIENT_PROXY_SECRET: 'test-client-gateway-secret-at-least-32',
  });
  const clients = [
    {
      id: 'acme-id',
      slug: 'acme',
      companyCode: 'ACME',
      name: 'ACME Mobility',
      isActive: true,
      status: 'ACTIVE',
      branding: { primaryColor: '#176b4c' },
    },
    {
      id: 'blue-id',
      slug: 'bluemobility',
      companyCode: 'BLUE',
      name: 'Blue Mobility',
      isActive: true,
      status: 'ACTIVE',
      branding: { primaryColor: '#174c92' },
    },
  ];
  const prisma = {
    session: { findFirst: vi.fn().mockResolvedValue({ id: 'session-a' }) },
    clientDomain: { findUnique: vi.fn().mockResolvedValue(null) },
    client: {
      findUnique: vi
        .fn()
        .mockImplementation(
          async ({ where }) =>
            clients.find((c) => c.slug === where.slug) ?? null,
        ),
      findFirst: vi
        .fn()
        .mockImplementation(
          async ({ where }) =>
            clients.find(
              (c) =>
                c.id === where.id &&
                c.isActive &&
                !['DRAFT', 'SUSPENDED'].includes(c.status),
            ) ?? null,
        ),
    },
    user: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 'user-a',
          clientId: 'acme-id',
          role: 'CLIENT_ADMIN',
          client: clients[0],
        }),
    },
    clientBranding: { upsert: vi.fn() },
  };
  const resolver = new ClientResolverService(prisma as never, config);
  return { config, clients, prisma, resolver };
}
describe('Client resolution', () => {
  it.each(['acme.evseye.com', 'ACME.EVSEYE.COM:3001', 'acme.localhost:3001'])(
    'resolves %s',
    async (hostname) => {
      expect(await setup().resolver.resolve(hostname)).toMatchObject({
        clientId: 'acme-id',
      });
    },
  );
  it.each([
    'app.evseye.com',
    'www.evseye.com',
    'api.evseye.com',
    'admin.evseye.com',
    'localhost:3001',
    '127.0.0.1:3001',
  ])('keeps %s generic', async (hostname) => {
    expect(await setup().resolver.resolve(hostname)).toBeNull();
  });
  it.each([
    'unknown.evseye.com',
    'unknown.customer.com',
    'acme.evseye.com.evil.com',
  ])('rejects unknown %s', async (hostname) => {
    await expect(setup().resolver.resolve(hostname)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it.each([
    'https://acme.evseye.com',
    'acme..evseye.com',
    'evil.com@acme.evseye.com',
    'acme.evseye.com,evil.com',
    '-acme.evseye.com',
    'acme.evseye.com:99999',
  ])('rejects malformed %s', (hostname) =>
    expect(() => normalizeHostname(hostname)).toThrow(),
  );
  it('rejects reserved/invalid new client slugs', () => {
    expect(validClientSlug('app')).toBe(false);
    expect(validClientSlug('ACME')).toBe(false);
    expect(validClientSlug('acme')).toBe(true);
  });
  it('blocks disabled clients immediately', async () => {
    const { resolver, clients } = setup();
    await resolver.resolve('acme.evseye.com');
    clients[0].isActive = false;
    await expect(resolver.resolve('acme.evseye.com')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('requires custom domain verification', async () => {
    const { resolver, prisma } = setup();
    prisma.clientDomain.findUnique.mockResolvedValue({
      clientId: 'acme-id',
      isVerified: false,
    });
    await expect(resolver.resolve('fleet.customer.com')).rejects.toThrow();
    prisma.clientDomain.findUnique.mockResolvedValue({
      clientId: 'acme-id',
      isVerified: true,
    });
    expect(await resolver.resolve('fleet.customer.com')).toMatchObject({
      clientId: 'acme-id',
    });
  });
  it('rejects browser supplied gateway headers without the gateway secret', async () => {
    await expect(
      setup().resolver.fromRequest({
        headers: { host: 'api.evseye.com', 'x-client-host': 'acme.evseye.com' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
describe('Client authorization and branding', () => {
  function guardSetup(host: string) {
    const { prisma, resolver } = setup();
    const request = {
      headers: { host, authorization: 'Bearer test' },
      user: undefined as unknown,
    };
    const guard = new AccessTokenGuard(
      {
        verifyAsync: vi
          .fn()
          .mockResolvedValue({
            id: 'user-a',
            clientId: 'acme-id',
            typ: 'access',
            sid: 'session-a',
            roles: ['SUPER_ADMIN'],
          }),
      } as never,
      { getOrThrow: () => 'secret' } as never,
      prisma as never,
      resolver,
    );
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    return { guard, request, context, prisma };
  }
  it('rejects revoked sessions before authorizing a client request', async () => {
    const { guard, context, prisma } = guardSetup('acme.evseye.com');
    prisma.session.findFirst.mockResolvedValue(null as never);
    await expect(guard.canActivate(context as never)).rejects.toThrow('Session is unavailable.');
  });
  it('allows own domain but takes current roles from the database', async () => {
    const { guard, request, context } = guardSetup('acme.evseye.com');
    expect(await guard.canActivate(context as never)).toBe(true);
    expect(request.user).toEqual({
      id: 'user-a',
      clientId: 'acme-id',
      roles: ['CLIENT_ADMIN'],
    });
  });
  it('blocks ACME token on Blue Mobility domain', async () => {
    const { guard, context } = guardSetup('bluemobility.evseye.com');
    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('supports existing generic app login', async () => {
    const { guard, context } = guardSetup('app.evseye.com');
    expect(await guard.canActivate(context as never)).toBe(true);
  });
  it('rejects revoked accounts even with an unexpired JWT', async () => {
    const { guard, context, prisma } = guardSetup('acme.evseye.com');
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(context as never)).rejects.toThrow(
      'Account is unavailable',
    );
  });
  it('returns only public fields and distinct branding', async () => {
    const { prisma } = setup();
    const service = new ClientBrandingService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const acme = await service.context('acme-id');
    const blue = await service.context('blue-id');
    expect(acme.branding.primaryColor).not.toBe(blue.branding.primaryColor);
    expect(Object.keys(acme)).toEqual(['client', 'branding']);
    expect(acme.client).toEqual({ displayName: 'ACME Mobility' });
    expect(JSON.stringify(acme)).not.toMatch(
      /acme-id|clientId|companyCode|verificationToken/,
    );
  });
  it('uses the authenticated client for updates, with no target ID argument', async () => {
    const branding = { update: vi.fn().mockResolvedValue({}) };
    const controller = new ClientBrandingController(
      branding as never,
      new ClientContextService(),
    );
    await controller.update(
      { id: 'user-a', clientId: 'acme-id', roles: ['CLIENT_ADMIN'] },
      { primaryColor: '#123456' },
    );
    expect(branding.update).toHaveBeenCalledWith(
      'acme-id',
      { primaryColor: '#123456' },
      'user-a',
    );
    const malicious = Object.assign(new UpdateBrandingDto(), {
      clientId: 'blue-id',
      primaryColor: 'url(javascript:alert(1))',
    });
    expect(
      (
        await validate(malicious, {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects another client’s uploaded branding object', async () => {
    const { prisma } = setup();
    const storage = { assertObjectExists: vi.fn() };
    const service = new ClientBrandingService(
      prisma as never,
      storage as never,
      {} as never,
    );
    await expect(
      service.complete(
        'acme-id',
        {
          kind: 'logo',
          objectKey:
            'clients/blue-id/branding/logo/00000000-0000-4000-8000-000000000000.png',
        },
        'user-a',
      ),
    ).rejects.toThrow('Invalid branding object');
    expect(storage.assertObjectExists).not.toHaveBeenCalled();
  });
});
