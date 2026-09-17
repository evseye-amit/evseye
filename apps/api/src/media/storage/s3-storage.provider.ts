import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
        ...(this.serverSideEncryption
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
