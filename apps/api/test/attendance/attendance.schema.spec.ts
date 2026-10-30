import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  new URL('../../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = [
  '../../prisma/migrations/20261027000000_schema_baseline/migration.sql',
  '../../prisma/migrations/20261027000100_non_schema_database_logic/migration.sql',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');

describe('attendance database contract', () => {
  it('declares the tenant snapshot, timestamps, and supporting indexes', () => {
    expect(schema).toContain('model AttendancePeriod');
    expect(schema).toContain('clientId   String?');
    expect(schema).toContain('@@index([userId, checkInAt])');
    expect(schema).toContain('@@index([clientId, checkInAt])');
  });

  it('enforces one open period and valid closed periods in the consolidated migrations', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "AttendancePeriod_userId_open_key"',
    );
    expect(migration).toContain('WHERE ("checkOutAt" IS NULL)');
    expect(migration).toContain(
      'CHECK ("checkOutAt" IS NULL OR "checkOutAt" > "checkInAt")',
    );
    expect(migration).toContain(
      'CREATE INDEX "AttendancePeriod_userId_checkInAt_idx"',
    );
    expect(migration).toContain(
      'CREATE INDEX "AttendancePeriod_clientId_checkInAt_idx"',
    );
  });
});
