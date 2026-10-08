import { PrismaClient } from '@prisma/client';
import { seedLegal } from './seed-legal.mjs';
import { seedLegalTemplates } from './seed-legal-templates.mjs';

const prisma = new PrismaClient();
try {
  await seedLegalTemplates(prisma);
  await seedLegal(prisma);
  console.info('Rider Terms and Privacy Policy 1.0.0 are available for yogmaya; platform templates are available for new clients.');
} finally {
  await prisma.$disconnect();
}
