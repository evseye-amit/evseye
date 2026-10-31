import { UserRole } from '@prisma/client';
import { createPrismaClient } from './prisma-client.mjs';

const mobile = process.env.SUPER_ADMIN_MOBILE ?? '9871675222';

export async function seedSuperAdmin(client, requestedMobile = mobile) {
  const normalizedMobile = requestedMobile.startsWith('+') ? requestedMobile : `+91${requestedMobile}`;
  const existing = await client.user.findFirst({
    where: { clientId: null, role: UserRole.SUPER_ADMIN },
    select: { id: true },
  });

  const user = existing
    ? await client.user.update({
        where: { id: existing.id },
        data: {
          mobile: normalizedMobile,
          name: 'EVs Eye Super Admin',
          role: UserRole.SUPER_ADMIN,
          isActive: true,
          deletedAt: null,
        },
      })
    : await client.user.create({
        data: {
          mobile: normalizedMobile,
          name: 'EVs Eye Super Admin',
          role: UserRole.SUPER_ADMIN,
          isActive: true,
        },
      });

  return user;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const prisma = createPrismaClient();
  seedSuperAdmin(prisma)
    .then((user) => {
      console.info(`Super Admin ready: ${user.mobile}`);
      console.info(process.env.NODE_ENV === 'production' ? 'Production login uses real-time OTP.' : 'Development/staging console OTP: 098765.');
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
