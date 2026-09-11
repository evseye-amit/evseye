import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  ServerSideEncryption,
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
  private readonly signingClient: S3Client;
  private readonly serverSideEncryption?: ServerSideEncryption;

  constructor(private readonly config: ConfigService<Environment, true>) {
    const region = config.getOrThrow('AWS_REGION');
    const endpoint = config.get('S3_ENDPOINT');
    const publicEndpoint = config.get('S3_PUBLIC_ENDPOINT');
    const clientOptions = {
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    };
    this.client = new S3Client(clientOptions);
    this.signingClient = publicEndpoint
      ? new S3Client({
          region,
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
