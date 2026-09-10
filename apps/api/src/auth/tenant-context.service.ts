import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from './interfaces/auth-user.interface.js';

@Injectable()
export class TenantContextService {
  requireTenantId(user: AuthUser): string {
    if (!user.tenantId) {
      throw new ForbiddenException('A tenant-scoped identity is required.');
    }
    return user.tenantId;
  }

  canAccessTenant(user: AuthUser, tenantId: string): boolean {
    return user.roles.includes('SUPER_ADMIN') || user.tenantId === tenantId;
  }
}
