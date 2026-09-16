import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  dirname,
  isAbsolute,
  join,
  posix,
  resolve,
  sep,
  win32,
} from 'node:path';
import type {
  CreateUploadUrlInput,
  StorageProvider,
  StorageTarget,
} from './storage-provider.interface.js';

export const LOCAL_UPLOAD_PATH = '/api/v1/storage/local/upload';
export const LOCAL_DOWNLOAD_PATH = '/api/v1/storage/local/download';
export const LOCAL_STORAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface LocalStorageProviderOptions {
  root?: string;
  ttlSeconds?: number;
  maxCapabilities?: number;
  now?: () => number;
}

export interface LocalDownload {
  stream: Readable;
  mimeType: string;
  sizeBytes: number;
}

interface UploadCapability {
  objectKey: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
  expiresAt: number;
}

interface DownloadCapability {
  objectKey: string;
  expiresAt: number;
}

type SupportedMimeType =
  'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

interface MagicSignature {
  offset: number;
  bytes: readonly number[];
}

const MIME_RULES: Record<
  SupportedMimeType,
  { magic: readonly MagicSignature[] }
> = {
  'application/pdf': {
    magic: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }],
  },
  'image/jpeg': { magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  'image/png': {
    magic: [
      {
        offset: 0,
        bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      },
    ],
  },
  'image/webp': {
    magic: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
};

export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly maxCapabilities: number;
  private readonly now: () => number;
  private readonly uploadCapabilities = new Map<string, UploadCapability>();
  private readonly downloadCapabilities = new Map<string, DownloadCapability>();

  constructor(options: LocalStorageProviderOptions = {}) {
    this.root = resolve(options.root ?? '.local-storage');
    this.ttlMs = (options.ttlSeconds ?? 300) * 1000;
    this.maxCapabilities = options.maxCapabilities ?? 10_000;
    this.now = options.now ?? Date.now;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error('Local storage capability TTL must be positive.');
    }
    if (!Number.isInteger(this.maxCapabilities) || this.maxCapabilities <= 0) {
      throw new Error('Local storage capability limit must be positive.');
    }
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<StorageTarget> {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Invalid upload request.');
    }
    const mimeType = this.supportedMimeType(input.mimeType);
    this.validateObjectKey(input.objectKey);
    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > LOCAL_STORAGE_MAX_BYTES
    ) {
      throw new BadRequestException('Upload size must be between 1 and 10 MB.');
    }
    this.purgeExpired();
    const token = this.issueToken();
    this.addBounded(this.uploadCapabilities, hashToken(token), {
      objectKey: input.objectKey,
      mimeType,
      sizeBytes: input.sizeBytes,
      expiresAt: this.now() + this.ttlMs,
    });
    return {
      url: LOCAL_UPLOAD_PATH,
      headers: {
        'X-Upload-Token': token,
        'Content-Type': mimeType,
      },
    };
  }

  async createDownloadUrl(objectKey: string): Promise<StorageTarget> {
    this.validateObjectKey(objectKey);
    this.purgeExpired();
    const token = this.issueToken();
    this.addBounded(this.downloadCapabilities, hashToken(token), {
      objectKey,
      expiresAt: this.now() + this.ttlMs,
    });
    return {
      url: LOCAL_DOWNLOAD_PATH,
      headers: { 'X-Download-Token': token },
    };
  }

  async assertObjectExists(objectKey: string): Promise<void> {
    const objectPath = await this.existingObjectPath(objectKey);
    const object = await stat(objectPath);
    if (!object.isFile()) {
      throw new NotFoundException('Stored object not found.');
    }
  }

  async consumeUpload(
    token: string,
    mimeType: string,
    body: Buffer,
  ): Promise<void> {
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Invalid or expired upload capability.');
    }
    this.purgeExpired();
    const capability = this.uploadCapabilities.get(hashToken(token));
    if (!capability) {
      throw new UnauthorizedException('Invalid or expired upload capability.');
    }
    this.uploadCapabilities.delete(hashToken(token));

    if (mimeType !== capability.mimeType) {
      throw new BadRequestException(
        'Upload MIME type does not match the capability.',
      );
    }
    if (!Buffer.isBuffer(body) || body.length !== capability.sizeBytes) {
      throw new BadRequestException(
        'Upload size does not match the expected size.',
      );
    }
    if (!matchesMagic(body, MIME_RULES[capability.mimeType].magic)) {
      throw new BadRequestException(
        'Upload content does not match its MIME type.',
      );
    }

    const objectPath = await this.objectPathForWrite(capability.objectKey);
    const temporaryPath = join(
      dirname(objectPath),
      `.${randomUUID()}.upload.tmp`,
    );
    try {
      await writeFile(temporaryPath, body, { flag: 'wx', mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      try {
        await lstat(objectPath);
        throw new BadRequestException('Stored object already exists.');
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      await rename(temporaryPath, objectPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async openDownload(token: string): Promise<LocalDownload> {
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException(
        'Invalid or expired download capability.',
      );
    }
    this.purgeExpired();
    const capability = this.downloadCapabilities.get(hashToken(token));
    if (!capability) {
      throw new UnauthorizedException(
        'Invalid or expired download capability.',
      );
    }
    const objectPath = await this.existingObjectPath(capability.objectKey);
    const object = await stat(objectPath);
    if (!object.isFile()) {
      throw new NotFoundException('Stored object not found.');
    }
    return {
      stream: createReadStream(objectPath),
      mimeType: mimeTypeForKey(capability.objectKey),
      sizeBytes: object.size,
    };
  }

  private async objectPathForWrite(objectKey: string): Promise<string> {
    this.validateObjectKey(objectKey);
    await this.ensureDirectory(dirname(resolve(this.root, objectKey)));
    const objectPath = resolve(this.root, objectKey);
    await this.assertPathInsideRoot(objectPath);
    return objectPath;
  }

  private async existingObjectPath(objectKey: string): Promise<string> {
    this.validateObjectKey(objectKey);
    const objectPath = resolve(this.root, objectKey);
    await this.assertPathInsideRoot(objectPath);
    try {
      const object = await lstat(objectPath);
      if (object.isSymbolicLink()) throw new Error('symlink');
    } catch (error) {
      if (isMissingFile(error)) {
        throw new NotFoundException('Stored object not found.');
      }
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Invalid object path.');
    }
    return objectPath;
  }

  private async ensureDirectory(directory: string): Promise<void> {
    await this.ensureRoot();
    const root = resolve(this.root);
    const relative = directory
      .slice(root.length)
      .split(/[\\/]/)
      .filter(Boolean);
    let current = root;
    for (const part of relative) {
      current = join(current, part);
      try {
        const entry = await lstat(current);
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new BadRequestException('Invalid object path.');
        }
      } catch (error) {
        if (!isMissingFile(error)) throw error;
        await mkdir(current, { mode: 0o700 });
      }
      await chmod(current, 0o700);
    }
  }

  private async ensureRoot(): Promise<void> {
    try {
      const entry = await lstat(this.root);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new BadRequestException('Invalid object path.');
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await mkdir(this.root, { recursive: true, mode: 0o700 });
    }
    await chmod(this.root, 0o700);
  }

  private async assertPathInsideRoot(objectPath: string): Promise<void> {
    await this.ensureRoot();
    const rootRealPath = await realpath(this.root);
    const parentRealPath = await realpath(dirname(objectPath)).catch(
      (error) => {
        if (isMissingFile(error)) return rootRealPath;
        throw error;
      },
    );
    if (
      parentRealPath !== rootRealPath &&
      !parentRealPath.startsWith(`${rootRealPath}${sep}`)
    ) {
      throw new BadRequestException('Invalid object path.');
    }
  }

  private validateObjectKey(objectKey: string): void {
    if (
      typeof objectKey !== 'string' ||
      !objectKey ||
      objectKey.includes('\u0000') ||
      objectKey.includes('\\') ||
      isAbsolute(objectKey) ||
      posix.isAbsolute(objectKey) ||
      win32.isAbsolute(objectKey) ||
      objectKey
        .split('/')
        .some((part) => part === '.' || part === '..' || !part)
    ) {
      throw new BadRequestException('Invalid object key.');
    }
  }

  private supportedMimeType(mimeType: string): SupportedMimeType {
    if (typeof mimeType === 'string' && Object.hasOwn(MIME_RULES, mimeType)) {
      return mimeType as SupportedMimeType;
    }
    throw new BadRequestException('Unsupported upload MIME type.');
  }

  private issueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [hash, capability] of this.uploadCapabilities) {
      if (capability.expiresAt <= now) this.uploadCapabilities.delete(hash);
    }
    for (const [hash, capability] of this.downloadCapabilities) {
      if (capability.expiresAt <= now) this.downloadCapabilities.delete(hash);
    }
  }

  private addBounded<T>(map: Map<string, T>, hash: string, value: T): void {
    while (map.size >= this.maxCapabilities) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
    map.set(hash, value);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function matchesMagic(body: Buffer, magic: readonly MagicSignature[]): boolean {
  return magic.every(({ offset, bytes }) =>
    bytes.every((byte, index) => body[offset + index] === byte),
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function mimeTypeForKey(objectKey: string): string {
  const extension = objectKey.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'application/octet-stream';
}
