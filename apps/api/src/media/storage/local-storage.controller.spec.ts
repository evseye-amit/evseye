import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalStorageController } from './local-storage.controller.js';
import { LocalStorageProvider } from './local-storage.provider.js';

describe('LocalStorageController', () => {
  it('uploads binary data and streams private attachment responses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    const controller = new LocalStorageController(provider);
    const body = Buffer.from('%PDF-1.7\ncontroller test');
    const upload = await provider.createUploadUrl({
      objectKey: 'clients/client-1/documents/document-1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: body.length,
    });

    await expect(
      controller.upload(
        upload.headers['X-Upload-Token'],
        'application/pdf; charset=binary',
        body,
      ),
    ).resolves.toBeUndefined();

    const download = await provider.createDownloadUrl(
      'clients/client-1/documents/document-1.pdf',
    );
    const reply = {
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    await controller.download(
      download.headers['X-Download-Token'],
      reply as never,
    );
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="download.pdf"',
    );
    expect(reply.header).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
    expect(reply.header).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(reply.send).toHaveBeenCalledWith(expect.anything());
  });

  it('accepts valid WebP bytes and rejects a RIFF body without WEBP bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evseye-storage-'));
    const provider = new LocalStorageProvider({ root, ttlSeconds: 60 });
    const controller = new LocalStorageController(provider);
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
      Buffer.from('VP8 '),
    ]);
    const upload = await provider.createUploadUrl({
      objectKey: 'clients/client-1/photos/photo-1.webp',
      mimeType: 'image/webp',
      sizeBytes: webp.length,
    });
    await expect(
      controller.upload(upload.headers['X-Upload-Token'], 'image/webp', webp),
    ).resolves.toBeUndefined();

    const invalid = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from('NOPE'),
    ]);
    const invalidUpload = await provider.createUploadUrl({
      objectKey: 'clients/client-1/photos/photo-2.webp',
      mimeType: 'image/webp',
      sizeBytes: invalid.length,
    });
    await expect(
      controller.upload(
        invalidUpload.headers['X-Upload-Token'],
        'image/webp',
        invalid,
      ),
    ).rejects.toThrow('Upload content does not match its MIME type.');
  });
});
