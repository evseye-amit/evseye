import { describe, expect, it, vi } from 'vitest';

const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example/upload'),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }));

import { S3StorageProvider } from './s3-storage.provider.js';

describe('S3StorageProvider upload target', () => {
  it('returns signed URL headers required by the S3 PutObject signature', async () => {
    const config = {
      get: vi.fn(
        (key: string) =>
          ({
            S3_ENDPOINT: undefined,
            S3_PUBLIC_ENDPOINT: undefined,
            S3_SERVER_SIDE_ENCRYPTION: 'AES256',
            S3_BUCKET: 'private-bucket',
          })[key],
      ),
      getOrThrow: vi.fn(
        (key: string) =>
          ({ AWS_REGION: 'ap-south-1', S3_SIGNED_URL_TTL_SECONDS: 300 })[key],
      ),
    };
    const provider = new S3StorageProvider(config as never);

    await expect(
      provider.createUploadUrl({
        objectKey: 'clients/client-1/document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      }),
    ).resolves.toEqual({
      url: 'https://s3.example/upload',
      headers: {
        'Content-Type': 'application/pdf',
        'x-amz-server-side-encryption': 'AES256',
      },
    });
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    expect(getSignedUrl.mock.calls[0]?.[2]).toEqual({ expiresIn: 300 });
  });

  it('does not add bearer authorization to upload targets', async () => {
    const config = {
      get: vi.fn(
        (key: string) =>
          ({
            S3_ENDPOINT: undefined,
            S3_PUBLIC_ENDPOINT: undefined,
            S3_SERVER_SIDE_ENCRYPTION: undefined,
            S3_BUCKET: 'private-bucket',
          })[key],
      ),
      getOrThrow: vi.fn(
        (key: string) =>
          ({ AWS_REGION: 'ap-south-1', S3_SIGNED_URL_TTL_SECONDS: 300 })[key],
      ),
    };
    const provider = new S3StorageProvider(config as never);
    const target = await provider.createUploadUrl({
      objectKey: 'clients/client-1/photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(target.headers).not.toHaveProperty('Authorization');
    expect(target.headers).not.toHaveProperty('authorization');
  });
});
