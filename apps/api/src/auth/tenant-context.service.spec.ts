import { describe, expect, it } from 'vitest';
import { TenantContextService } from './tenant-context.service.js';

describe('TenantContextService', () => {
  const service = new TenantContextService();

  it('rejects a tenant-scoped operation without a tenant identity', () => {
    expect(() => service.requireTenantId({ id: 'admin', tenantId: null, roles: ['SUPER_ADMIN'] })).toThrow(
      'tenant-scoped identity',
    );
  });

  it('does not allow an ordinary tenant user to cross tenant boundaries', () => {
    expect(service.canAccessTenant({ id: 'a', tenantId: 'tenant-a', roles: ['CLIENT_ADMIN'] }, 'tenant-b')).toBe(false);
  });
});
