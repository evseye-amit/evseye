import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import type {
  CreateUploadUrlInput,
  StorageProvider,
} from './storage-provider.interface.js';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: ConfigService<Environment, true>) {
    this.client = new S3Client({ region: config.getOrThrow('AWS_REGION') });
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<string> {
    const bucket = this.bucket();
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ContentLength: input.sizeBytes,
        ServerSideEncryption: 'aws:kms',
      }),
      { expiresIn: this.config.getOrThrow('S3_SIGNED_URL_TTL_SECONDS') },
    );
  }

  async createDownloadUrl(objectKey: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket(), Key: objectKey }),
      { expiresIn: this.config.getOrThrow('S3_SIGNED_URL_TTL_SECONDS') },
    );
  }

  async assertObjectExists(objectKey: string): Promise<void> {
    await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket(), Key: objectKey }),
    );
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
