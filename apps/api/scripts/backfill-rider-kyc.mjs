// Run after the migration and build: node scripts/backfill-rider-kyc.mjs
import 'reflect-metadata';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RiderKycStatusService } from '../dist/riders/rider-kyc-status.service.js';
import { RiderOnboardingConfigurationService } from '../dist/riders/rider-onboarding-configuration.service.js';
import { WorkflowResolverService } from '../dist/workflow/workflow-resolver.service.js';

const prisma = new PrismaService();
const kyc = new RiderKycStatusService(
  prisma,
  new RiderOnboardingConfigurationService(
    prisma,
    new WorkflowResolverService(prisma),
  ),
);
try {
  const clients = await prisma.rider.findMany({
    where: { deletedAt: null },
    distinct: ['clientId'],
    select: { clientId: true },
  });
  let count = 0;
  for (const { clientId } of clients) {
    const fields = await kyc.fields(clientId);
    const riders = await prisma.rider.findMany({
      where: { clientId, deletedAt: null, userId: { not: null } },
      select: { userId: true },
    });
    for (const { userId } of riders) {
      await prisma.$transaction(async (tx) => {
        await kyc.lockUser(tx, clientId, userId);
        await kyc.sync(tx, clientId, userId, fields);
      });
      count++;
    }
  }
  console.log(`Updated overall KYC for ${count} riders.`);
} finally {
  await prisma.$disconnect();
}
