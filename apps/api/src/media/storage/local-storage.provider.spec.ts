import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStorageProvider } from './local-storage.provider.js';
import type { CreateUploadUrlInput } from './storage-provider.interface.js';

const pdf = Buffer.from('%PDF-1.7\nprivate test');
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 '),
]);

async function issue(
  provider: LocalStorageProvider,
  overrides: Partial<CreateUploadUrlInput> = {},
) {
  return provider.createUploadUrl({
    objectKey: 'clients/client-1/documents/document-1.pdf',
    mimeType: 'application/pdf',
    sizeBytes: pdf.length,
    ...overrides,
  });
}

describe('LocalStorageProvider', () => {
  it('stores a valid upload and serves it through a reusable download capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    const upload = await issue(provider);

    expect(upload.url).toBe('/api/v1/storage/local/upload');
    const token = upload.headers['X-Upload-Token'];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await provider.consumeUpload(token, 'application/pdf', pdf);
    await expect(
      provider.assertObjectExists('clients/client-1/documents/document-1.pdf'),
    ).resolves.toBeUndefined();

    const download = await provider.createDownloadUrl(
      'clients/client-1/documents/document-1.pdf',
    );
    const opened = await provider.openDownload(
      download.headers['X-Download-Token'],
    );
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(pdf);
    expect(opened.mimeType).toBe('application/pdf');
    expect(
      await readFile(join(root, 'clients/client-1/documents/document-1.pdf')),
    ).toEqual(pdf);

    const openedAgain = await provider.openDownload(
      download.headers['X-Download-Token'],
    );
    openedAgain.stream.destroy();
  });

  it('rejects missing and reused upload capabilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    await expect(
      provider.consumeUpload('', 'application/pdf', pdf),
    ).rejects.toThrow('Invalid or expired upload capability.');
    const upload = await issue(provider);
    await provider.consumeUpload(
      upload.headers['X-Upload-Token'],
      'application/pdf',
      pdf,
    );
    await expect(
      provider.consumeUpload(
        upload.headers['X-Upload-Token'],
        'application/pdf',
        pdf,
      ),
    ).rejects.toThrow('Invalid or expired upload capability.');
  });

  it('rejects expired capabilities and malformed object keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    let now = 1_000;
    const provider = new LocalStorageProvider({
      root,
      ttlSeconds: 1,
      now: () => now,
    });
    const upload = await issue(provider);
    now += 1_001;
    await expect(
      provider.consumeUpload(
        upload.headers['X-Upload-Token'],
        'application/pdf',
        pdf,
      ),
    ).rejects.toThrow('Invalid or expired upload capability.');
    for (const objectKey of [
      '../outside.pdf',
      '/absolute.pdf',
      'clients/./document.pdf',
      'clients/../document.pdf',
      'clients\\document.pdf',
      'clients/\u0000document.pdf',
    ]) {
      await expect(
        provider.createUploadUrl({
          objectKey,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
        }),
      ).rejects.toThrow('Invalid object key.');
    }
  });

  it('rejects MIME, magic-byte, and exact-size mismatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    const cases = [
      ['image/jpeg', pdf, pdf.length],
      ['application/pdf', Buffer.from('not a pdf'), pdf.length],
      ['application/pdf', pdf, pdf.length + 1],
    ] as const;
    for (const [mimeType, body, sizeBytes] of cases) {
      const upload = await issue(provider, { mimeType, sizeBytes });
      await expect(
        provider.consumeUpload(
          upload.headers['X-Upload-Token'],
          mimeType,
          body,
        ),
      ).rejects.toThrow();
    }
  });

  it('stores a valid WebP and rejects a RIFF file without a WEBP signature', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    const upload = await issue(provider, {
      objectKey: 'clients/client-1/photos/photo-1.webp',
      mimeType: 'image/webp',
      sizeBytes: webp.length,
    });
    await expect(
      provider.consumeUpload(
        upload.headers['X-Upload-Token'],
        'image/webp',
        webp,
      ),
    ).resolves.toBeUndefined();
    const download = await provider.createDownloadUrl(
      'clients/client-1/photos/photo-1.webp',
    );
    const opened = await provider.openDownload(
      download.headers['X-Download-Token'],
    );
    expect(opened.mimeType).toBe('image/webp');
    opened.stream.destroy();

    const invalid = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from('NOPE'),
    ]);
    const invalidUpload = await issue(provider, {
      objectKey: 'clients/client-1/photos/photo-2.webp',
      mimeType: 'image/webp',
      sizeBytes: invalid.length,
    });
    await expect(
      provider.consumeUpload(
        invalidUpload.headers['X-Upload-Token'],
        'image/webp',
        invalid,
      ),
    ).rejects.toThrow('Upload content does not match its MIME type.');
  });

  it('refuses a symlinked object directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const outside = await mkdtemp(join(tmpdir(), 'evseye-storage-outside-'));
    await symlink(outside, join(root, 'clients'));
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    const upload = await issue(provider);
    await expect(
      provider.consumeUpload(
        upload.headers['X-Upload-Token'],
        'application/pdf',
        pdf,
      ),
    ).rejects.toThrow('Invalid object path.');
  });

  it('cleans temporary files when an atomic publish fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const directory = join(root, 'clients/client-1/documents');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'document-1.pdf'), pdf, { mode: 0o600 });
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    const upload = await issue(provider);

    await expect(
      provider.consumeUpload(
        upload.headers['X-Upload-Token'],
        'application/pdf',
        pdf,
      ),
    ).rejects.toThrow('Stored object already exists.');
    await expect(readdir(directory)).resolves.toEqual(['document-1.pdf']);
  });
});
