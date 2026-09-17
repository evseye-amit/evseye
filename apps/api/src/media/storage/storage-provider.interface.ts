export interface CreateUploadUrlInput {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageProvider {
  createUploadUrl(input: CreateUploadUrlInput): Promise<string>;
  createDownloadUrl(objectKey: string): Promise<string>;
  /** Returns a stable delivery URL for non-sensitive public assets. */
  createPublicUrl(objectKey: string): string;
  assertObjectExists(objectKey: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
