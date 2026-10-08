import { PrismaClient } from '@prisma/client';
import { seedLegal } from './seed-legal.mjs';

const prisma = new PrismaClient();
try {
  await seedLegal(prisma);
  console.info('Rider Terms 1.0.0 is available for yogmaya.');
} finally {
  await prisma.$disconnect();
}
