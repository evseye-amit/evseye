import { describe, expect, it } from 'vitest';
import { ClientContextService } from './client-context.service.js';

describe('ClientContextService', () => {
  const service = new ClientContextService();

  it('rejects a client-scoped operation without a client identity', () => {
    expect(() => service.requireClientId({ id: 'admin', clientId: null, roles: ['SUPER_ADMIN'] })).toThrow(
      'client-scoped identity',
    );
  });

  it('does not allow an ordinary client user to cross client boundaries', () => {
    expect(service.canAccessClient({ id: 'a', clientId: 'client-a', roles: ['CLIENT_ADMIN'] }, 'client-b')).toBe(false);
  });
});
