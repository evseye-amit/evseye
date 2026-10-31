import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetDirectory = fileURLToPath(new URL('./catalog/assets/oem/', import.meta.url));
const contentTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function createS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({
    region: process.env.AWS_REGION ?? 'ap-south-1',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

export async function seedOemLogos(prisma) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.warn('Skipping OEM logos because S3_BUCKET is not configured.');
    return;
  }

  const files = await readdir(assetDirectory);
  const assetsByCode = new Map(
    files.map((file) => [file.slice(0, -extname(file).length).toUpperCase(), file]),
  );
  const oems = await prisma.oem.findMany({
    select: { id: true, code: true, logoObjectKey: true },
    orderBy: { code: 'asc' },
  });
  const client = createS3Client();
  let uploaded = 0;
  let preserved = 0;
  const missingAssets = [];

  try {
    for (const oem of oems) {
      // An Admin-uploaded logo takes precedence over the catalog default.
      if (oem.logoObjectKey) {
        preserved += 1;
        continue;
      }

      const file = assetsByCode.get(oem.code.toUpperCase());
      if (!file) {
        missingAssets.push(oem.code);
        continue;
      }

      const extension = extname(file).toLowerCase();
      const objectKey = `platform/oems/${oem.id}/logo/seed${extension}`;
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: await readFile(join(assetDirectory, file)),
        ContentType: contentTypes[extension] ?? 'application/octet-stream',
        CacheControl: 'public, max-age=86400',
      }));
      await prisma.oem.update({ where: { id: oem.id }, data: { logoObjectKey: objectKey } });
      uploaded += 1;
    }
  } finally {
    client.destroy();
  }

  console.info(`Seeded ${uploaded} OEM logos; preserved ${preserved} existing logos.`);
  if (missingAssets.length) {
    console.warn(`No checked-in logo asset for OEMs: ${missingAssets.join(', ')}.`);
  }
}
