import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3StorageProvider } from './s3-storage.provider.js';

function storage(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    AWS_REGION: 'ap-south-1', S3_BUCKET: 'evseye-logos-production',
    S3_SIGNED_URL_TTL_SECONDS: '300', ...overrides,
  };
  const get = (key: string) => key === 'S3_SIGNED_URL_TTL_SECONDS' ? Number(values[key]) : values[key];
  return new S3StorageProvider({ get, getOrThrow: get } as never);
}

describe('Presigned client logo storage', () => {
  beforeEach(() => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-access-key');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret-key');
    vi.stubEnv('AWS_SESSION_TOKEN', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not sign AES256 browser uploads with the SSE header', async () => {
    const provider = storage({ S3_SERVER_SIDE_ENCRYPTION: 'AES256' });
    const url = new URL(
      await provider.createUploadUrl({
        objectKey: 'clients/client-1/logo/logo.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      }),
    );

    expect(url.searchParams.get('X-Amz-SignedHeaders')).not.toContain(
      'x-amz-server-side-encryption',
    );
  });

  it('keeps the SSE header signed for aws:kms browser uploads', async () => {
    const provider = storage({ S3_SERVER_SIDE_ENCRYPTION: 'aws:kms' });
    const url = new URL(
      await provider.createUploadUrl({
        objectKey: 'clients/client-1/logo/logo.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      }),
    );

    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain(
      'x-amz-server-side-encryption',
    );
  });

  it('signs browser uploads and downloads against local MinIO', async () => {
    const provider = storage({ S3_BUCKET: 'evs-eye-local', S3_ENDPOINT: 'http://minio:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:9000' });
    const objectKey = 'clients/client-1/logo/logo.png';
    const urls = [
      await provider.createUploadUrl({ objectKey, mimeType: 'image/png', sizeBytes: 1024 }),
      await provider.createDownloadUrl(objectKey),
    ];
    for (const value of urls) {
      const url = new URL(value);
      expect(url.origin).toBe('http://localhost:9000');
      expect(url.pathname).toBe(`/evs-eye-local/${objectKey}`);
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    }
  });

  it('signs private AWS S3 URLs when local endpoint overrides are unset', async () => {
    const provider = storage();
    const objectKey = 'clients/client-1/logo/logo.png';
    for (const value of [await provider.createUploadUrl({ objectKey, mimeType: 'image/png', sizeBytes: 1024 }), await provider.createDownloadUrl(objectKey)]) {
      const url = new URL(value);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('evseye-logos-production.s3.ap-south-1.amazonaws.com');
      expect(url.pathname).toBe(`/${objectKey}`);
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    }
  });
});

describe('stored branding image validation', () => {
  it('rejects oversized files before reading their bytes', async () => {
    const provider = storage();
    const send = vi.spyOn(provider['client'], 'send').mockResolvedValue({ ContentLength: 3 * 1024 * 1024, ContentType: 'image/png' } as never);
    await expect(provider.assertObjectExists('image.png', { maxBytes: 2 * 1024 * 1024 })).rejects.toThrow('invalid size');
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });
  it('rejects an HTML payload labelled as a PNG', async () => {
    const provider = storage();
    const send = vi.spyOn(provider['client'], 'send')
      .mockResolvedValueOnce({ ContentLength: 100, ContentType: 'image/png' } as never)
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => Buffer.from('<html>unsafe') } } as never);
    await expect(provider.assertObjectExists('image.png', { maxBytes: 2 * 1024 * 1024 })).rejects.toThrow('not a supported image');
    send.mockRestore();
  });
});
