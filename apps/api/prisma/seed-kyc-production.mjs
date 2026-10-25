import { PrismaClient } from '@prisma/client';
import { seedKyc } from './seed-kyc.mjs';

if (process.env.NODE_ENV !== 'production' ||
  process.env.KYC_SANDBOX_ENVIRONMENT !== 'PRODUCTION' ||
  process.env.KYC_SANDBOX_SECRET_REFERENCE !== 'env:KYC_SANDBOX_PRODUCTION') {
  throw new Error('Production Sandbox KYC seed requires the live environment.');
}

const prisma = new PrismaClient();
try {
  await seedKyc(prisma, true, 'env:KYC_SANDBOX_PRODUCTION', 'PRODUCTION');
} finally {
  await prisma.$disconnect();
}
