import { describe, expect, it, vi } from 'vitest';
import { PublicPreLoginController } from '../../src/client-identity/pre-login.controller.js';
import { UserRole } from '@prisma/client';

describe('PublicPreLoginController', () => {
  it('resolves the request host before returning the bootstrap contract', async () => {
    const service = {
      publicBootstrap: vi.fn().mockResolvedValue({
        client: { id: 'client-1' },
        appCode: 'RIDER',
        role: UserRole.RIDER,
      }),
    };
    const resolver = {
      fromRequest: vi.fn().mockResolvedValue({ clientId: 'client-1' }),
    };
    const controller = new PublicPreLoginController(
      service as never,
      resolver as never,
    );

    const result = await controller.bootstrap(
      { companyCode: 'acme', appCode: 'RIDER', role: UserRole.RIDER },
      { headers: { host: 'acme.evseye.com' } } as never,
    );

    expect(resolver.fromRequest).toHaveBeenCalledWith({
      headers: { host: 'acme.evseye.com' },
    });
    expect(service.publicBootstrap).toHaveBeenCalledWith(
      'acme',
      'RIDER',
      UserRole.RIDER,
      'client-1',
    );
    expect(result.data.client.id).toBe('client-1');
  });
});
