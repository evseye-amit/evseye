import type { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  tenantId: string | null;
  roles: UserRole[];
  sessionId?: string;
}
