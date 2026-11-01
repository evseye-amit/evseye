import { ImportEntityType, ImportScope, ImportStatus } from '@prisma/client';
import { normalizeImportFailures, type ImportFailure } from './import-failure.js';

export type PlatformImportResult = {
  jobId: string;
  entityType: ImportEntityType;
  scope: ImportScope;
  status: ImportStatus;
  totalRows: number;
  passedRows: number;
  failedRows: number;
  failures: ImportFailure[];
};

export { normalizeImportFailures };
