import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Client: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  execFileSync: vi.fn(),
  query: vi.fn(),
}));

vi.mock('pg', () => ({ Client: mocks.Client }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync }));

const schemaBaseline = '20261101000400_schema_consolidated';
const nonSchemaBaseline = '20261101000500_non_schema_consolidated';
const legacyMigrations = [
  '20261027000000_schema_baseline',
  '20261027000100_non_schema_database_logic',
  '20261030231000_fix_freeze_preparation_photo_trigger',
  '20261031000200_client_onboarding_rejections',
  '20261031000300_client_subscription_single_open',
  '20261031000400_package_feature_effective_dates',
  '20261031000500_sms_delivery_tracking',
  '20261031062911_remove_unused_return_penalty_tables',
  '20261101000100_sms_provider_policy',
  '20261101000200_import_parent_jobs',
  '20261101000300_platform_import_scope',
];

let client: {
  connect: typeof mocks.connect;
  end: typeof mocks.end;
  query: typeof mocks.query;
};

async function loadScript() {
  // @ts-expect-error The migration runner is a standalone .mjs script and has no TypeScript declarations.
  await import('../../scripts/deploy-migrations.mjs');
}

function migrationRows(names: string[]) {
  return names.map((migration_name) => ({ migration_name }));
}

describe('deploy-migrations baseline adoption', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.DATABASE_URL = 'postgres://migration-test';
    client = {
      connect: mocks.connect,
      end: mocks.end,
      query: mocks.query,
    };
    mocks.Client.mockImplementation(function MockClient() {
      return client;
    });
    mocks.connect.mockResolvedValue(undefined);
    mocks.end.mockResolvedValue(undefined);
    mocks.execFileSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('does not resolve consolidated baselines that are already applied', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({
        rows: migrationRows([
          ...legacyMigrations,
          schemaBaseline,
          nonSchemaBaseline,
        ]),
      });

    await loadScript();

    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('finished_at IS NOT NULL'),
      [expect.arrayContaining([schemaBaseline, nonSchemaBaseline])],
    );
    expect(mocks.query.mock.calls[1]?.[0]).toContain('rolled_back_at IS NULL');
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      './apps/api/node_modules/.bin/prisma',
      ['migrate', 'deploy', '--config=apps/api/prisma.config.ts'],
      { stdio: 'inherit' },
    );
  });

  it('deploys a fresh consolidated database with both baselines already applied', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({
        rows: migrationRows([schemaBaseline, nonSchemaBaseline]),
      })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    await loadScript();

    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      './apps/api/node_modules/.bin/prisma',
      ['migrate', 'deploy', '--config=apps/api/prisma.config.ts'],
      { stdio: 'inherit' },
    );
  });

  it('lets Prisma continue a fresh consolidated database after the schema baseline succeeds', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: migrationRows([schemaBaseline]) })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    await loadScript();

    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      './apps/api/node_modules/.bin/prisma',
      ['migrate', 'deploy', '--config=apps/api/prisma.config.ts'],
      { stdio: 'inherit' },
    );
  });

  it('resolves each consolidated baseline when legacy history is complete and baselines are absent', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: migrationRows(legacyMigrations) });

    await loadScript();

    expect(mocks.execFileSync).toHaveBeenNthCalledWith(
      1,
      './apps/api/node_modules/.bin/prisma',
      [
        'migrate',
        'resolve',
        '--applied',
        schemaBaseline,
        '--config=apps/api/prisma.config.ts',
      ],
      { stdio: 'inherit' },
    );
    expect(mocks.execFileSync).toHaveBeenNthCalledWith(
      2,
      './apps/api/node_modules/.bin/prisma',
      [
        'migrate',
        'resolve',
        '--applied',
        nonSchemaBaseline,
        '--config=apps/api/prisma.config.ts',
      ],
      { stdio: 'inherit' },
    );
    expect(mocks.execFileSync).toHaveBeenNthCalledWith(
      3,
      './apps/api/node_modules/.bin/prisma',
      ['migrate', 'deploy', '--config=apps/api/prisma.config.ts'],
      { stdio: 'inherit' },
    );
  });

  it('keeps refusing an existing schema with incomplete legacy history', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({
        rows: migrationRows([
          ...legacyMigrations.slice(0, -1),
          nonSchemaBaseline,
        ]),
      })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    await expect(loadScript()).rejects.toThrow(
      'Refusing to apply a fresh-schema baseline to an existing database with incomplete migration history.',
    );
    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
});
