import { PrismaClient } from '@prisma/client';
import { repairBasicLegalConsent } from './catalog/repair-basic-legal-consent.mjs';
const prisma = new PrismaClient();
try {
  console.info('Basic legal consent configuration repaired:', await repairBasicLegalConsent(prisma));
  console.info('Create a fresh Package draft in Super Admin. Existing drafts and subscription versions were preserved.');
} finally {
  await prisma.$disconnect();
}
