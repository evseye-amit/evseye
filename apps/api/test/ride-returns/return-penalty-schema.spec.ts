import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  new URL('../../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20261031062911_remove_unused_return_penalty_tables/migration.sql',
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

  it('refuses to drop populated tables and drops the child table first', () => {
    const itemDrop = migration.indexOf('DROP TABLE "ReturnPenaltyItem";');
    const caseDrop = migration.indexOf('DROP TABLE "ReturnPenaltyCase";');

    expect(migration.includes('BEGIN;')).toBe(true);
    expect(
      migration.includes(
        'LOCK TABLE "ReturnPenaltyCase", "ReturnPenaltyItem" IN ACCESS EXCLUSIVE MODE;',
      ),
    ).toBe(true);
    expect(
      migration.includes('IF EXISTS (SELECT 1 FROM "ReturnPenaltyCase")'),
    ).toBe(true);
    expect(
      migration.includes('OR EXISTS (SELECT 1 FROM "ReturnPenaltyItem")'),
    ).toBe(true);
    expect(migration.includes('RAISE EXCEPTION')).toBe(true);
    expect(itemDrop).toBeGreaterThanOrEqual(0);
    expect(caseDrop).toBeGreaterThanOrEqual(0);
    expect(itemDrop).toBeLessThan(caseDrop);
    expect(migration.includes('CASCADE')).toBe(false);
    expect(migration.includes('COMMIT;')).toBe(true);
  });
});
