export interface CreateUploadUrlInput {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageTarget {
  url: string;
  headers: Readonly<Record<string, string>>;
}

export function normalizeStorageTarget(
  target: StorageTarget | string,
): StorageTarget {
  return typeof target === 'string' ? { url: target, headers: {} } : target;
}

export interface StorageProvider {
  createUploadUrl(input: CreateUploadUrlInput): Promise<StorageTarget>;
  createDownloadUrl(objectKey: string): Promise<StorageTarget>;
  assertObjectExists(objectKey: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
