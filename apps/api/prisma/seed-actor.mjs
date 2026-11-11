import { UserRole } from '@prisma/client';

// Bootstrap seeds may run before a client admin is created through onboarding.
// Use the platform Super Admin only as an audit actor; it is never a client login.
export async function findSeedActor(prisma, clientId) {
  const clientAdmin = await prisma.user.findFirst({
    where: { clientId, role: UserRole.CLIENT_ADMIN, isActive: true, deletedAt: null },
    orderBy: { id: 'asc' },
  });
  if (clientAdmin) return clientAdmin;
  return prisma.user.findFirst({
    where: { clientId: null, role: UserRole.SUPER_ADMIN, isActive: true, deletedAt: null },
    orderBy: { id: 'asc' },
  });
}
