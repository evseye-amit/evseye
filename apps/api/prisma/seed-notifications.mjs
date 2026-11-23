import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from './prisma-client.mjs';

export const notificationCatalog = JSON.parse(
  readFileSync(new URL('./notification-catalog.json', import.meta.url), 'utf8'),
);
export const notificationApplications = [
  'RIDER',
  'FLEET_MANAGER',
  'TEAM_LEADER',
  'ADMIN',
];

/** Insert missing definitions only: rerunning seeds must not undo administrator edits. */
export async function seedNotifications(prisma) {
  return prisma.$transaction(
    async (tx) => {
      for (const [sortOrder, group] of notificationCatalog.groups.entries()) {
        await tx.notificationParentGroup.upsert({
          where: { code: group.code },
          create: { ...group, sortOrder },
          update: {},
        });
      }
      for (const {
        applications,
        ...category
      } of notificationCatalog.categories) {
        await tx.notificationCategory.upsert({
          where: { code: category.code },
          create: category,
          update: {},
        });
        for (const application of notificationApplications) {
          await tx.notificationApplicationCategory.upsert({
            where: {
              categoryCode_application: {
                categoryCode: category.code,
                application,
              },
            },
            create: {
              categoryCode: category.code,
              application,
              allowed: applications.includes(application),
            },
            update: {},
          });
        }
      }
      return {
        groups: notificationCatalog.groups.length,
        categories: notificationCatalog.categories.length,
      };
    },
    { timeout: 60000 },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const prisma = createPrismaClient();
  seedNotifications(prisma)
    .then(console.info)
    .catch(() => {
      console.error(
        'Notification catalog seed failed. Check database migration and connectivity.',
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
