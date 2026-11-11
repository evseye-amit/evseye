import type { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  clientId: string | null;
  roles: UserRole[];
  sessionId?: string;
}
