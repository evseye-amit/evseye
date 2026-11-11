import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from './interfaces/auth-user.interface.js';

@Injectable()
export class ClientContextService {
  requireClientId(user: AuthUser): string {
    if (!user.clientId) {
      throw new ForbiddenException('A client-scoped identity is required.');
    }
    return user.clientId;
  }

  canAccessClient(user: AuthUser, clientId: string): boolean {
    return user.roles.includes('SUPER_ADMIN') || user.clientId === clientId;
  }
}
