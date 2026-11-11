import { createTestPrisma } from '../helpers/prisma-client.js';
import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkPartnersService } from '../../src/work-partners/work-partners.service.js';
import { AuditService } from '../../src/audit/audit.service.js';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
const url = process.env.WORK_PARTNER_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_')) throw new Error('Use a disposable test database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
const service = new WorkPartnersService(db as never, new AuditService(db as never));
afterAll(() => db.$disconnect());
const code = () => `WP_${randomUUID().replaceAll('-', '').toUpperCase()}`;
const fields = { name: 'Delivery partner', legalName: 'Delivery Partner Limited', category: 'FOOD_DELIVERY', logo: '/logos/work-partners/PARTNER.svg' };
async function fixture() {
  const client = await db.client.create({ data: { name: 'Import test', slug: randomUUID() } });
  const user = await db.user.create({ data: { clientId: client.id, role: 'CLIENT_ADMIN', mobile: '+919000000001', name: 'Import admin' } });
  return { client, actor: { id: user.id, clientId: client.id, roles: ['CLIENT_ADMIN'] } as AuthUser };
}
describe.skipIf(!url)('Work partner bulk import in PostgreSQL', () => {
  it('imports valid masters, reports row-specific errors, persists history and preserves existing codes', async () => {
    const user = await db.user.create({ data: { name: 'Root import admin', mobile: '+919000000099', role: 'SUPER_ADMIN' } });
    const actor: AuthUser = { id: user.id, clientId: null, roles: ['SUPER_ADMIN'] };
    const partCode = code();
    const result = await service.bulkCreate(actor, { filename: 'partners.csv', rows: [
      { code: partCode, ...fields }, { code: partCode, ...fields, name: 'Overwrite attempt' },
      { code: code(), ...fields, category: 'NOT_A_CATEGORY' }, { code: code(), ...fields, logo: 'https://external.example/logo.svg' },
    ] });
    expect(result).toMatchObject({ totalRows: 4, passedRows: 1, failedRows: 3, status: 'PARTIAL_PASS' });
    expect(result.failures.map((failure) => failure.row)).toEqual([3, 4, 5]);
    expect(result.failures[1].message).toContain('category');
    expect((await db.workPartnerMaster.findUniqueOrThrow({ where: { code: partCode } })).name).toBe(fields.name);
    expect(await service.importHistory(actor)).toEqual(expect.arrayContaining([expect.objectContaining({ id: result.id, fileName: 'partners.csv', passedRows: 1 })]));
    expect(await service.importFailures(actor, result.id)).toHaveLength(3);
    const f = await fixture();
    await expect(service.importFailures(f.actor, result.id, f.client.id)).rejects.toThrow('not found');
    await expect(service.bulkCreate(actor, { filename: 'empty.csv', rows: [] })).rejects.toThrow('1 and 100');
    await expect(service.bulkCreate(actor, { filename: 'too-many.csv', rows: Array(101).fill({ code: code(), ...fields }) })).rejects.toThrow('1 and 100');
  });
  it('keeps client imports independent and isolates history, rows and failure reports by tenant', async () => {
    const f = await fixture(), other = await fixture(), partnerCode = code();
    const result = await service.bulkCreate(f.actor, { filename: 'client.csv', rows: [
      { code: partnerCode, ...fields, workType: 'Delivery routes', website: 'https://example.com' },
      { code: code(), ...fields, clientId: other.client.id },
    ] }, f.client.id);
    expect(result).toMatchObject({ passedRows: 1, failedRows: 1 });
    expect(result.failures[0].message).toContain('clientId');
    const row = await db.clientWorkPartner.findUniqueOrThrow({ where: { clientId_code: { clientId: f.client.id, code: partnerCode } } });
    expect(row).toMatchObject({ sourceMasterId: null, category: 'FOOD_DELIVERY', logo: fields.logo, workType: 'Delivery routes' });
    expect(await service.importHistory(other.actor, other.client.id)).toEqual([]);
    await expect(service.importFailures(other.actor, result.id, other.client.id)).rejects.toThrow('not found');
    await expect(service.importHistory(f.actor, other.client.id)).rejects.toThrow('permission');
    await expect(service.bulkCreate({ ...f.actor, roles: ['FLEET_MANAGER'] }, { filename: 'bad.csv', rows: [{ code: code(), ...fields }] }, f.client.id)).rejects.toThrow('permission');
    const retry = await service.bulkCreate(f.actor, { filename: 'retry.csv', rows: [{ code: partnerCode, ...fields, name: 'Overwrite attempt' }] }, f.client.id);
    expect(retry).toMatchObject({ passedRows: 0, failedRows: 1, status: 'FAIL' });
    expect((await db.clientWorkPartner.findUniqueOrThrow({ where: { id: row.id } })).name).toBe(fields.name);
    await expect(service.importFailures(f.actor, '9999999999999999999', f.client.id)).rejects.toThrow('Invalid import');
  });
});
