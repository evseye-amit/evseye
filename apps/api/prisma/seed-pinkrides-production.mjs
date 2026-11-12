import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { clientSeed } from './client/pinkrides/client.mjs';
import { createPrismaClient } from './prisma-client.mjs';

async function seedPinkridesProduction(prisma, bucket) {
  const client = await prisma.client.upsert({
    where: { slug: clientSeed.client.slug },
    create: clientSeed.client,
    update: {},
    include: {
      businessProfile: { select: { logoObjectKey: true } },
      branding: { select: { logoObjectKey: true } },
    },
  });
  if (client.branding?.logoObjectKey) return;

  const existingKey = client.businessProfile?.logoObjectKey;
  const logoObjectKey = existingKey ?? `clients/${client.id}/logo/seed.png`;
  if (!existingKey) {
    const endpoint = process.env.S3_ENDPOINT;
    const storage = new S3Client({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      requestChecksumCalculation: 'WHEN_REQUIRED',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    try {
      await storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: logoObjectKey,
          Body: await readFile(
            new URL('./client/pinkrides/assets/logo.png', import.meta.url),
          ),
          ContentType: 'image/png',
          CacheControl: 'public, max-age=86400',
        }),
      );
    } finally {
      storage.destroy();
    }
  }

  await prisma.clientBranding.upsert({
    where: { clientId: client.id },
    create: { clientId: client.id, logoObjectKey },
    update: { logoObjectKey },
  });
}

const bucket = process.env.S3_BUCKET;
if (!bucket)
  throw new Error('S3_BUCKET is required for the Pinkrides production seed.');

const prisma = createPrismaClient();
try {
  await seedPinkridesProduction(prisma, bucket);
  console.info('Pinkrides client and branding are configured.');
} finally {
  await prisma.$disconnect();
}
