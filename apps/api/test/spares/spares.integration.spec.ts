import { createTestPrisma } from '../helpers/prisma-client.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SparesService } from '../../src/spares/spares.service.js';
import { copyActiveSpareMasters } from '../../src/spares/spares-copy.js';
import { PlatformAdminService } from '../../src/platform-admin/platform-admin.service.js';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
const url = process.env.SPARES_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable test database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
const service = new SparesService(db as never);
const platform: AuthUser = {
  id: randomUUID(),
  clientId: null,
  roles: ['SUPER_ADMIN'],
};
const metadata = {
  name: 'Test panel',
  baseRate: '150.00',
  gstPercent: '18.00',
  hsnCode: '12345678',
  unit: 'PIECE',
  vehicleTypeIds: [],
};
afterAll(() => db.$disconnect());
describe.skipIf(!url)('Spares catalogue in PostgreSQL', () => {
  async function fixture() {
    const key = randomUUID();
    const client = await db.client.create({
      data: { name: 'Spares test', slug: key, status: 'ACTIVE' },
    });
    const admin = await db.user.create({
      data: {
        clientId: client.id,
        role: 'CLIENT_ADMIN',
        name: 'Admin',
        mobile: '+919000000001',
      },
    });
    return {
      client,
      actor: {
        id: admin.id,
        clientId: client.id,
        roles: ['CLIENT_ADMIN'],
      } as AuthUser,
    };
  }
  const code = () => `SP_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  it('copies active masters during direct and draft client creation without charging riders', async () => {
    const master = await service.createMaster(platform, {
      code: code(),
      ...metadata,
    });
    const admin = new PlatformAdminService(
      db as never,
      { record: vi.fn() } as never,
      {} as never,
      { send: vi.fn().mockResolvedValue({ status: 'SKIPPED' }) } as never,
    );
    const draft = await admin.createClientDraft(
      {
        businessFleetName: 'Draft operator',
        companyCode: `draft-${randomUUID()}`,
        legalEntityName: 'Draft Ltd',
        businessType: 'PRIVATE',
        clientType: 'FLEET',
        pan: 'TESTPAN',
        estimatedFleetSize: 0,
        estimatedRiderCount: 0,
        estimatedUserCount: 1,
      },
      platform.id,
    );
    for (const client of [draft]) {
      const copy = await db.returnPenaltyPrice.findUniqueOrThrow({
        where: {
          clientId_masterSpareId: {
            clientId: client.id,
            masterSpareId: master.id,
          },
        },
      });
      expect(copy.penaltyConfigured).toBe(false);
      expect(copy.isActive).toBe(false);
      expect(copy.sourceVersion).toBe(1);
      expect(copy.evidenceRequired).toBe(true);
      await db.$transaction((tx) =>
        copyActiveSpareMasters(tx, client.id, platform.id),
      );
      expect(
        await db.returnPenaltyPrice.count({
          where: { clientId: client.id, masterSpareId: master.id },
        }),
      ).toBe(1);
    }
  });
  it('keeps client-created spares private and reports code conflicts without overwriting them', async () => {
    const a = await fixture(),
      b = await fixture();
    const partCode = code();
    const own = await service.createClientSpare(a.client.id, a.actor, {
      code: partCode,
      ...metadata,
      penaltyAmount: '250',
      evidenceRequired: false,
      isActive: true,
    });
    await service.createMaster(platform, {
      code: partCode,
      ...metadata,
      name: 'Global equivalent',
    });
    const result = await service.importMissing(a.client.id, a.actor);
    expect(result.conflicts.some((c) => c.code === partCode)).toBe(true);
    const saved = await db.returnPenaltyPrice.findUniqueOrThrow({
      where: { id: own.id },
    });
    expect(saved.masterSpareId).toBeNull();
    expect(saved.name).toBe(metadata.name);
    expect(saved.amount.toFixed(2)).toBe('250.00');
    expect(
      (await service.list(b.client.id, b.actor, { search: partCode })).total,
    ).toBe(0);
    await expect(
      service.updateClient(b.client.id, b.actor, own.id, {
        expectedVersion: 1,
        reason: 'Attempt cross tenant update',
        penaltyAmount: '1',
      }),
    ).rejects.toThrow('not found');
    await expect(service.history(b.actor, own.id, b.client.id)).rejects.toThrow(
      'not found',
    );
  });
  it('applies reviewed master reference changes while preserving client penalty settings', async () => {
    const f = await fixture(),
      master = await service.createMaster(platform, {
        code: code(),
        ...metadata,
      });
    await service.importMissing(f.client.id, f.actor);
    const copy = await db.returnPenaltyPrice.findUniqueOrThrow({
      where: {
        clientId_masterSpareId: {
          clientId: f.client.id,
          masterSpareId: master.id,
        },
      },
    });
    await service.updateClient(f.client.id, f.actor, copy.id, {
      expectedVersion: 1,
      reason: 'Client penalty decision',
      penaltyAmount: '300',
      evidenceRequired: false,
      isActive: true,
    });
    await service.updateMaster(platform, master.id, {
      expectedVersion: 1,
      reason: 'Supplier reference updated',
      baseRate: '200',
      gstPercent: '12',
      isActive: false,
    });
    const catalogue = await service.catalogue(f.client.id, f.actor, { page: 1, limit: 100 });
    const propagated = catalogue.data.find((item) => item.id === copy.id)!;
    expect(propagated.origin).toBe('MASTER');
    expect(propagated.version).toBe(2);
    expect(propagated.masterUpdateAvailable).toBe(true);
    expect(propagated.masterInactive).toBe(true);
    expect(propagated.allowedFindingTypes).toEqual(['DAMAGE', 'MISSING_ITEM']);
    const preview = (await service.preview(f.client.id, f.actor)).find(
      (p) => p.priceId === copy.id,
    )!;
    expect(preview.masterActive).toBe(false);
    await service.apply(f.client.id, f.actor, {
      reason: 'Review completed',
      items: [
        {
          priceId: copy.id,
          expectedVersion: preview.expectedVersion,
          masterVersion: preview.masterVersion,
        },
      ],
    });
    const saved = await db.returnPenaltyPrice.findUniqueOrThrow({
      where: { id: copy.id },
    });
    expect(saved.baseRate!.toFixed(2)).toBe('200.00');
    expect(saved.amount.toFixed(2)).toBe('300.00');
    expect(saved.evidenceRequired).toBe(false);
    expect(saved.isActive).toBe(true);
    expect(saved.sourceVersion).toBe(2);
    await expect(
      service.apply(f.client.id, f.actor, {
        reason: 'Stale preview',
        items: [preview],
      }),
    ).rejects.toThrow();
    await expect(
      service.updateClient(f.client.id, f.actor, copy.id, {
        expectedVersion: saved.configurationVersion,
        reason: 'Manual master edit',
        baseRate: '1',
      }),
    ).rejects.toThrow('client-created');
  });
  it('requires administrator access, configured amounts and optimistic versions; retains immutable history', async () => {
    const f = await fixture();
    const own = await service.createClientSpare(f.client.id, f.actor, {
      code: code(),
      ...metadata,
    });
    await expect(
      service.updateClient(f.client.id, f.actor, own.id, {
        expectedVersion: 1,
        reason: 'Enable without amount',
        isActive: true,
      }),
    ).rejects.toThrow('Configure');
    const first = await service.updateClient(f.client.id, f.actor, own.id, {
      expectedVersion: 1,
      reason: 'Set penalty',
      penaltyAmount: '100',
      isActive: true,
    });
    await expect(
      service.updateClient(f.client.id, f.actor, own.id, {
        expectedVersion: 1,
        reason: 'Old form',
        penaltyAmount: '500',
      }),
    ).rejects.toThrow('changed');
    const fm: AuthUser = { ...f.actor, roles: ['FLEET_MANAGER'] };
    await expect(
      service.updateClient(f.client.id, fm, own.id, {
        expectedVersion: 2,
        reason: 'Unauthorized',
        penaltyAmount: '1',
      }),
    ).rejects.toThrow('Administrator');
    await expect(
      service.createMaster(f.actor, { code: code(), ...metadata }),
    ).rejects.toThrow('Administrator');
    const history = await service.history(f.actor, own.id, f.client.id);
    expect(history).toHaveLength(2);
    expect(first.version).toBe(2);
    await expect(
      db.spareCatalogueRevision.update({
        where: { id: history[0].id },
        data: { reason: 'Tamper' },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      service.createClientSpare(f.client.id, f.actor, {
        code: code(),
        ...metadata,
        gstPercent: '101',
      }),
    ).rejects.toThrow();
  });
  it('returns enabled configured master, client and non-spare penalties with pagination and search', async () => {
    const f = await fixture();
    await service.createClientSpare(f.client.id, f.actor, {
      code: code(),
      ...metadata,
      name: 'Searchable spare',
      penaltyAmount: '10',
      isActive: true,
    });
    await service.createClientSpare(f.client.id, f.actor, {
      code: code(),
      ...metadata,
      name: 'Searchable disabled',
    });
    await db.returnPenaltyPrice.create({
      data: {
        clientId: f.client.id,
        code: code(),
        category: 'DAMAGE',
        description: 'Searchable operational penalty',
        amount: '20',
        currency: 'INR',
        createdById: f.actor.id,
      },
    });
    const result = await service.catalogue(
      f.client.id,
      { ...f.actor, roles: ['FLEET_MANAGER'] },
      { search: 'Searchable', limit: 1, page: 1 },
    );
    expect(result.meta.total).toBe(2);
    expect(result.data).toHaveLength(1);
    expect(result.meta.totalPages).toBe(2);
    const all = await service.catalogue(f.client.id, f.actor, {
      search: 'Searchable',
      limit: 100,
    });
    expect(all.data.some((p) => p.origin === 'CLIENT')).toBe(true);
    expect(all.data.some((p) => p.origin === 'NON_SPARE')).toBe(true);
    expect(all.data.every((p) => p.version === 1 && p.evidenceRequired)).toBe(
      true,
    );
  });
  it('bulk imports master spares with row failures, durable history and duplicate protection', async () => {
    const root = await db.user.create({ data: { role: 'SUPER_ADMIN', name: 'Import admin', mobile: '+919000000099' } });
    const actor: AuthUser = { id: root.id, clientId: null, roles: ['SUPER_ADMIN'] };
    const partCode = code();
    const result = await service.bulkCreate(actor, { filename: 'spares.csv', rows: [
      { code: partCode, ...metadata },
      { code: partCode, ...metadata, baseRate: '999' },
      { code: code(), ...metadata, gstPercent: '101' },
    ] });
    expect(result).toMatchObject({ status: 'PARTIAL_PASS', passedRows: 1, failedRows: 2, totalRows: 3 });
    expect(result.failures.map((row) => row.row)).toEqual([3, 4]);
    expect((await db.sparePartMaster.findUniqueOrThrow({ where: { code: partCode } })).baseRate.toFixed(2)).toBe('150.00');
    expect(await service.importHistory(actor)).toEqual(expect.arrayContaining([expect.objectContaining({ id: result.id, fileName: 'spares.csv' })]));
    expect(await service.importFailures(actor, result.id)).toHaveLength(2);
    const f = await fixture();
    await expect(service.importFailures(f.actor, result.id, f.client.id)).rejects.toThrow('not found');
    await expect(service.bulkCreate(actor, { filename: 'too-many.csv', rows: Array(101).fill(metadata) })).rejects.toThrow();
  });
  it('bulk client imports preserve client ownership, evidence rules and tenant boundaries', async () => {
    const f = await fixture(), other = await fixture();
    const partCode = code();
    const row = { code: partCode, ...metadata, penaltyAmount: '197.00', evidenceRequired: false, isActive: true };
    const result = await service.bulkCreate(f.actor, { filename: 'client.csv', rows: [row, { ...row, code: code(), penaltyAmount: null }] }, f.client.id);
    expect(result).toMatchObject({ passedRows: 1, failedRows: 1 });
    const part = await db.returnPenaltyPrice.findUniqueOrThrow({ where: { clientId_code: { clientId: f.client.id, code: partCode } } });
    expect(part.masterSpareId).toBeNull();
    expect(part.amount.toFixed(2)).toBe('197.00');
    expect(part.evidenceRequired).toBe(false);
    expect(await db.spareCatalogueRevision.count({ where: { priceId: part.id } })).toBe(1);
    expect(await service.importFailures(f.actor, result.id, f.client.id)).toHaveLength(1);
    expect(await service.importHistory(other.actor, other.client.id)).toEqual([]);
    await expect(service.importFailures(other.actor, result.id, other.client.id)).rejects.toThrow('not found');
    await expect(service.bulkCreate({ ...f.actor, roles: ['FLEET_MANAGER'] }, { filename: 'client.csv', rows: [row] }, f.client.id)).rejects.toThrow('permission');
    const retry = await service.bulkCreate(f.actor, { filename: 'retry.csv', rows: [row] }, f.client.id);
    expect(retry).toMatchObject({ passedRows: 0, failedRows: 1 });
  });

});
