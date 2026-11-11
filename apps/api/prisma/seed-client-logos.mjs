import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const yogmayaLogo = fileURLToPath(
  new URL('./catalog/assets/clients/yogmaya.jpg', import.meta.url),
);

function createS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({
    region: process.env.AWS_REGION ?? 'ap-south-1',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

export async function seedClientLogos(prisma) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.warn('Skipping client logos because S3_BUCKET is not configured.');
    return;
  }

  const clientRecord = await prisma.client.findUnique({
    where: { slug: 'yogmaya' },
    select: {
      id: true,
      businessProfile: { select: { logoObjectKey: true } },
      branding: { select: { logoObjectKey: true } },
    },
  });
  if (!clientRecord) throw new Error('Yogmaya must be seeded before its logo.');

  const existingKey =
    clientRecord.branding?.logoObjectKey ?? clientRecord.businessProfile?.logoObjectKey;
  if (existingKey && !existingKey.endsWith('/logo/seed.jpg')) {
    console.info(`Preserved existing Yogmaya logo at ${existingKey}.`);
    return;
  }

  const objectKey = `clients/${clientRecord.id}/logo/seed.jpg`;
  const storage = createS3Client();
  try {
    await storage.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: await readFile(yogmayaLogo),
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=86400',
    }));
  } finally {
    storage.destroy();
  }

  await prisma.clientBusinessProfile.update({
    where: { clientId: clientRecord.id },
    data: { logoObjectKey: objectKey },
  });
  await prisma.clientBranding.upsert({
    where: { clientId: clientRecord.id },
    create: { clientId: clientRecord.id, logoObjectKey: objectKey },
    update: { logoObjectKey: objectKey },
  });
  console.info(`Seeded Yogmaya logo at ${objectKey}.`);
}
