import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  new URL('../../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20261101000400_schema_consolidated/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('return penalty schema cleanup', () => {
  it('removes only the unused case and item models', () => {
    expect(schema.includes('ReturnPenaltyCase')).toBe(false);
    expect(schema.includes('ReturnPenaltyItem')).toBe(false);
    expect(schema.includes('model ReturnPenaltyPrice')).toBe(true);
  });

  it('omits the removed case and item tables but retains penalty pricing', () => {
    expect(migration).not.toContain('CREATE TABLE "ReturnPenaltyCase"');
    expect(migration).not.toContain('CREATE TABLE "ReturnPenaltyItem"');
    expect(migration).toContain('CREATE TABLE "ReturnPenaltyPrice"');
  });
});
