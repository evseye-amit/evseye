import { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import type {
  CreateUploadUrlInput,
  StorageProvider,
} from './storage-provider.interface.js';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly signingClient: S3Client;
  private readonly serverSideEncryption?: ServerSideEncryption;

  constructor(private readonly config: ConfigService<Environment, true>) {
    const region = config.getOrThrow('AWS_REGION');
    const endpoint = config.get('S3_ENDPOINT');
    const publicEndpoint = config.get('S3_PUBLIC_ENDPOINT');
    const clientOptions = {
      region,
      // MinIO and S3 only require request checksums for specific operations.
      // Avoid optional SDK checksum headers on signed browser uploads.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    };
    this.client = new S3Client(clientOptions);
    this.signingClient = publicEndpoint
      ? new S3Client({
          region,
          requestChecksumCalculation: 'WHEN_REQUIRED' as const,
          endpoint: publicEndpoint,
          forcePathStyle: true,
        })
      : this.client;
    this.serverSideEncryption = config.get('S3_SERVER_SIDE_ENCRYPTION');
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<string> {
    const bucket = this.bucket();
    return getSignedUrl(
      this.signingClient,
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ContentLength: input.sizeBytes,
        ...(this.serverSideEncryption === 'aws:kms'
          ? { ServerSideEncryption: this.serverSideEncryption }
          : {}),
      }),
      { expiresIn: this.config.getOrThrow('S3_SIGNED_URL_TTL_SECONDS') },
    );
  }

  async createDownloadUrl(objectKey: string): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({ Bucket: this.bucket(), Key: objectKey }),
      { expiresIn: this.config.getOrThrow('S3_SIGNED_URL_TTL_SECONDS') },
    );
  }
  async readObject(objectKey: string, maxBytes: number): Promise<Uint8Array> {
    const startedAt = Date.now();
    let body: Readable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(), Key: objectKey }), { abortSignal: AbortSignal.timeout(15000) });
      if (!(result.Body instanceof Readable)) throw new ServiceUnavailableException('Receipt image could not be loaded. Please retry.');
      body = result.Body;
      if (result.ContentLength !== undefined && (result.ContentLength < 1 || result.ContentLength > maxBytes))
        throw new BadRequestException('Receipt image has an invalid size.');
      timer = setTimeout(() => body?.destroy(new Error('Storage read timed out.')), Math.max(1, 15000 - (Date.now() - startedAt)));
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) throw new BadRequestException('Receipt image exceeds the allowed size.');
        chunks.push(bytes);
      }
      if (!size) throw new NotFoundException('Receipt image is empty or unavailable.');
      return Buffer.concat(chunks, size);
    } catch (cause) {
      if (cause instanceof BadRequestException || cause instanceof NotFoundException) throw cause;
      if ((cause instanceof Error && ['NoSuchKey', 'NotFound'].includes(cause.name)) ||
        (cause instanceof S3ServiceException && cause.$metadata.httpStatusCode === 404))
        throw new NotFoundException('Receipt image was not found in storage.');
      throw new ServiceUnavailableException('Receipt image could not be loaded. Please retry or contact support.');
    } finally {
      if (timer) clearTimeout(timer);
      body?.destroy();
    }
  }
  async sealObject(sourceKey: string, destinationKey: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket(), Key: destinationKey,
      CopySource: `${this.bucket()}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
      ...(this.serverSideEncryption === 'aws:kms' ? { ServerSideEncryption: this.serverSideEncryption } : {}),
    }));
  }

  createPublicUrl(objectKey: string): string {
    const baseUrl =
      this.config.get('MEDIA_PUBLIC_BASE_URL') ??
      (this.config.get('S3_PUBLIC_ENDPOINT')
        ? `${this.config.getOrThrow('S3_PUBLIC_ENDPOINT')}/${this.bucket()}`
        : undefined);
    if (!baseUrl) {
      throw new ServiceUnavailableException(
        'Public media delivery is not configured.',
      );
    }
    return `${baseUrl.replace(/\/$/, '')}/${objectKey
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  async assertObjectExists(objectKey: string, image?: { maxBytes: number }): Promise<void> {
    const metadata = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket(), Key: objectKey }),
    );
    if (image) {
      const expected = objectKey.endsWith('.png') ? 'image/png' : objectKey.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
      if (!metadata.ContentLength || metadata.ContentLength > image.maxBytes || metadata.ContentType !== expected) throw new BadRequestException('Uploaded image has an invalid size or content type.');
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(), Key: objectKey, Range: 'bytes=0-11' }));
      const bytes = Buffer.from(await object.Body!.transformToByteArray());
      const valid = expected === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : expected === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw new BadRequestException('Uploaded file is not a supported image.');
    }
  }

  private bucket(): string {
    const bucket = this.config.get('S3_BUCKET');
    if (!bucket) {
      throw new ServiceUnavailableException(
        'Object storage is not configured.',
      );
    }
    return bucket;
  }
}
