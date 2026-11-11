export interface CreateUploadUrlInput {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageProvider {
  createUploadUrl(input: CreateUploadUrlInput): Promise<string>;
  createDownloadUrl(objectKey: string): Promise<string>;
  /** Read private bytes through the server storage endpoint with a strict size limit. */
  readObject(objectKey: string, maxBytes: number): Promise<Uint8Array>;
  /** Returns a stable delivery URL for non-sensitive public assets. */
  createPublicUrl(objectKey: string): string;
  assertObjectExists(objectKey: string, image?: { maxBytes: number }): Promise<void>;
  /** Copy evidence to a server-only key that has never had a signed upload URL. */
  sealObject(sourceKey: string, destinationKey: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
