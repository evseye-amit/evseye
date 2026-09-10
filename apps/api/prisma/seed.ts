import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: { name: 'EVs Eye Demo', isActive: true },
    create: { slug: 'demo', name: 'EVs Eye Demo' },
  });

  await prisma.user.upsert({
    where: { tenantId_mobile: { tenantId: tenant.id, mobile: '+919000000000' } },
    update: { name: 'Demo Tenant Admin', role: UserRole.TENANT_ADMIN, isActive: true },
    create: {
      tenantId: tenant.id,
      mobile: '+919000000000',
      name: 'Demo Tenant Admin',
      role: UserRole.TENANT_ADMIN,
    },
  });

  console.info('Seeded tenant "demo" and demo tenant administrator.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
