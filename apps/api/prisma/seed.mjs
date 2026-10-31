import { PrismaClient } from '@prisma/client';
import { createThirdPartyConfig } from './create-third-party-config.mjs';
import { seedInitialRevisions } from './catalog/seed-revisions.mjs';
import { seedSuperAdmin } from './seed-super-admin.mjs';
import { seedMasterData } from './seed-master-data.mjs';
import { seedYogmaya } from './seed-yogmaya.mjs';

const prisma = new PrismaClient();

async function main() {
  await seedSuperAdmin(prisma);
  await seedMasterData(prisma);
  await seedYogmaya(prisma);

  await createThirdPartyConfig(prisma);

  // Existing development subscriptions are pinned after their records are seeded.
  await seedInitialRevisions(prisma);

  console.info('Seeded platform master data, client configuration, fleet components, manager users, and Super Admin account.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
