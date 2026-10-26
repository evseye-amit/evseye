import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FleetManagerMaintenanceService } from './maintenance.service.js';
import { MaintenanceFleetsQueryDto } from './maintenance.dto.js';

const url = process.env.MAINTENANCE_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
afterAll(() => db.$disconnect());
const service = new FleetManagerMaintenanceService(db as never);
describe.skipIf(!url)('maintenance fleet APIs in PostgreSQL', () => {
  async function fixture() {
    const key = randomUUID();
    const client = await db.client.create({
      data: { name: 'Maintenance', slug: key, status: 'ACTIVE' },
    });
    const manager = await db.user.create({
      data: {
        clientId: client.id,
        name: 'Manager',
        mobile: '9876543210',
        role: 'FLEET_MANAGER',
      },
    });
    const hub = await db.hub.create({
      data: { clientId: client.id, code: 'HOME', name: 'Home hub' },
    });
    const other = await db.hub.create({
      data: { clientId: client.id, code: 'OTHER', name: 'Other hub' },
    });
    await db.userHub.create({
      data: { clientId: client.id, userId: manager.id, hubId: hub.id },
    });
    const oem = await db.oem.create({
      data: { code: key, name: key, displayName: key },
    });
    const category = await db.vehicleCategory.create({
      data: { code: key, name: key },
    });
    const type = await db.vehicleType.create({
      data: {
        categoryId: category.id,
        code: key,
        name: key,
        energyType: 'ELECTRIC',
      },
    });
    const fleet = (
      name: string,
      status: 'MAINTENANCE' | 'AVAILABLE' = 'MAINTENANCE',
      hubId = hub.id,
    ) =>
      db.fleet.create({
        data: {
          clientId: client.id,
          fleetCode: name,
          chassisNumber: randomUUID(),
          modelName: name,
          oemId: oem.id,
          vehicleCategoryId: category.id,
          vehicleTypeId: type.id,
          speedType: 'SLOW_SPEED',
          currentHubId: hubId,
          status,
        },
      });
    return { clientId: client.id, manager, hub, other, fleet };
  }
  const query = (values: Partial<MaintenanceFleetsQueryDto> = {}) =>
    Object.assign(new MaintenanceFleetsQueryDto(), values);

  it('includes both new maintenance conditions and filters by fleet status', async () => {
    const f = await fixture();
    const broken = await f.fleet('Broken motor');
    const parts = await f.fleet('Awaiting controller');
    await db.fleet.update({ where: { id: broken.id }, data: { status: 'BROKEN', allocationEnabled: false } });
    await db.fleet.update({ where: { id: parts.id }, data: { status: 'AWAITING_PARTS', allocationEnabled: false } });
    const all = await service.list(f.clientId, f.manager.id, query());
    expect(all.summary.underMaintenance).toBe(2);
    const filtered = await service.list(f.clientId, f.manager.id, query({ fleetStatus: 'AWAITING_PARTS' }));
    expect(filtered.items.map(item => item.id)).toEqual([parts.id]);
    expect(filtered.summary.underMaintenance).toBe(2);
    expect((await service.get(f.clientId, f.manager.id, broken.id)).fleet.status).toBe('BROKEN');
  });

  it('lists only scoped maintenance fleet with pagination, search and an unfiltered scope count', async () => {
    const f = await fixture();
    const first = await f.fleet('Tyres');
    await f.fleet('Motor');
    await f.fleet('Brakes');
    await f.fleet('Available', 'AVAILABLE');
    await f.fleet('Other hub', 'MAINTENANCE', f.other.id);
    const deleted = await f.fleet('Deleted');
    await db.fleet.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    });
    const foreign = await fixture();
    await foreign.fleet('Foreign');
    const page1 = await service.list(
      f.clientId,
      f.manager.id,
      query({ pageSize: 2 }),
    );
    const page2 = await service.list(
      f.clientId,
      f.manager.id,
      query({ page: 2, pageSize: 2 }),
    );
    expect(page1.meta).toEqual({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(page2.items).toHaveLength(1);
    expect(
      new Set([...page1.items, ...page2.items].map((row) => row.id)).size,
    ).toBe(3);
    expect(page1.summary.underMaintenance).toBe(3);
    const searched = await service.list(
      f.clientId,
      f.manager.id,
      query({ search: 'tYrEs' }),
    );
    expect(searched.items.map((row) => row.id)).toEqual([first.id]);
    expect(searched.meta.total).toBe(1);
    expect(searched.summary.underMaintenance).toBe(3);
    expect(
      (
        await service.list(
          f.clientId,
          f.manager.id,
          query({ search: 'Other hub' }),
        )
      ).items,
    ).toEqual([]);
    expect(
      (
        await service.list(
          f.clientId,
          f.manager.id,
          query({ search: 'Foreign' }),
        )
      ).items,
    ).toEqual([]);
    expect(
      (await service.list(f.clientId, f.manager.id, query({ page: 100 })))
        .items,
    ).toEqual([]);
  });

  it('rejects other-client, unassigned, deleted and non-maintenance details and inactive hubs', async () => {
    const f = await fixture();
    const fleet = await f.fleet('Scoped');
    expect(
      (await service.get(f.clientId, f.manager.id, fleet.id)).fleet.id,
    ).toBe(fleet.id);
    const otherFleet = await f.fleet('Outside', 'MAINTENANCE', f.other.id);
    const activeFleet = await f.fleet('Ready', 'AVAILABLE');
    const foreign = await fixture();
    const foreignFleet = await foreign.fleet('Foreign');
    for (const id of [
      otherFleet.id,
      activeFleet.id,
      foreignFleet.id,
      randomUUID(),
    ])
      await expect(service.get(f.clientId, f.manager.id, id)).rejects.toThrow(
        'not found',
      );
    await expect(
      service.list(f.clientId, f.manager.id, query({ hubId: f.other.id })),
    ).rejects.toThrow('assigned hubs');
    await db.hub.update({
      where: { id: f.hub.id },
      data: { status: 'INACTIVE' },
    });
    expect(
      (await service.list(f.clientId, f.manager.id, query())).items,
    ).toEqual([]);
    await expect(
      service.get(f.clientId, f.manager.id, fleet.id),
    ).rejects.toThrow('not found');
  });

  it('uses the assigned home hub only when current hub is missing, matching the home maintenance count', async () => {
    const f = await fixture();
    const fleet = await f.fleet('Home fallback');
    await db.fleet.update({
      where: { id: fleet.id },
      data: { currentHubId: null, homeHubId: f.hub.id },
    });
    expect(
      (await service.get(f.clientId, f.manager.id, fleet.id)).fleet.hub?.id,
    ).toBe(f.hub.id);
    expect(
      (await service.list(f.clientId, f.manager.id, query())).meta.total,
    ).toBe(1);
    await db.fleet.update({
      where: { id: fleet.id },
      data: { currentHubId: f.other.id },
    });
    await expect(
      service.get(f.clientId, f.manager.id, fleet.id),
    ).rejects.toThrow('not found');
  });

  it('returns honest empty report/history values and recorded maintenance reasons', async () => {
    const f = await fixture();
    const fleet = await f.fleet('Manual maintenance');
    const empty = await service.get(f.clientId, f.manager.id, fleet.id);
    expect(empty.latestMechanicReport).toBeNull();
    expect(empty.fleet.lastRecordedMaintenanceChange).toBeNull();
    expect(empty.mechanicReports).toEqual([]);
    expect(empty.statusHistory).toEqual([]);
    await db.fleetStatusHistory.create({
      data: {
        fleetId: fleet.id,
        toStatus: 'MAINTENANCE',
        fromStatus: 'AVAILABLE',
        reason: 'Tyre replacement',
        changedByUserId: f.manager.id,
      },
    });
    const result = await service.list(f.clientId, f.manager.id, query());
    expect(result.items[0].lastRecordedMaintenanceChange?.reason).toBe(
      'Tyre replacement',
    );
  });

  it('exposes finalized report summaries and valid evidence references without OTP or financial internals', async () => {
    const f = await fixture();
    const fleet = await f.fleet('Needs checks');
    const rider = await db.rider.create({
      data: {
        clientId: f.clientId,
        name: 'Rider',
        mobile: '9123456789',
        status: 'ACTIVE',
      },
    });
    const allocation = await db.allocation.create({
      data: {
        clientId: f.clientId,
        riderId: rider.id,
        fleetId: fleet.id,
        initiatedById: f.manager.id,
        status: 'COMPLETED',
      },
    });
    const inspection = await db.inspection.create({
      data: {
        clientId: f.clientId,
        allocationId: allocation.id,
        type: 'POST_DEALLOCATION',
      },
    });
    const key = randomUUID();
    const snapshot = {
      currency: 'INR',
      rental: { period: 'WEEKLY', finalAmount: '1400.00' },
      oneTimeCharges: [],
    };
    const offer = await db.riderCommercialOffer.create({
      data: {
        clientId: f.clientId,
        offerNumber: key,
        riderId: rider.id,
        vehicleId: fleet.id,
        rateCardId: 'historical',
        rateCardVersionId: 'historical',
        rentalPeriodType: 'WEEKLY',
        effectiveDate: new Date('2026-01-01'),
        currency: 'INR',
        status: 'ACCEPTED',
        finalRecurringAmount: 1400,
        upfrontAmount: 0,
        refundableAmount: 0,
        pricingSnapshot: snapshot,
        calculationHash: 'a'.repeat(64),
        selectionHash: 'a'.repeat(64),
        termsVersion: '1',
        termsTitle: 'Terms',
        termsSnapshot: 'Terms',
        termsHash: 'b'.repeat(64),
        expiresAt: new Date('2099-01-01'),
        createdById: f.manager.id,
      },
    });
    const agreement = await db.riderRentalAgreement.create({
      data: {
        clientId: f.clientId,
        agreementNumber: key,
        commercialOfferId: offer.id,
        riderId: rider.id,
        vehicleId: fleet.id,
        currentVehicleId: fleet.id,
        rateCardId: 'historical',
        rateCardVersionId: 'historical',
        rentalPeriodType: 'WEEKLY',
        currency: 'INR',
        startDate: new Date('2026-01-01'),
        status: 'ACTIVE',
        finalRecurringAmount: 1400,
        upfrontAmount: 0,
        refundableAmount: 0,
        pricingSnapshot: snapshot,
        pricingSnapshotSchemaVersion: 1,
        pricingHash: 'a'.repeat(64),
        termsSnapshot: 'Terms',
        termsVersion: '1',
        termsTitle: 'Terms',
        termsHash: 'b'.repeat(64),
        acceptedAt: new Date('2026-01-01'),
        acceptedById: f.manager.id,
        acceptanceMethod: 'OPERATIONS_ASSISTED',
        createdById: f.manager.id,
      },
    });
    const request = await db.rentalTerminationRequest.create({
      data: {
        clientId: f.clientId,
        riderId: rider.id,
        agreementId: agreement.id,
        allocationId: allocation.id,
        plannedHubId: f.hub.id,
        requestedTerminationDate: new Date(),
        reasonCode: 'RETURN',
        requestedById: f.manager.id,
        idempotencyKey: key,
      },
    });
    const submission = await db.vehicleSubmission.create({
      data: {
        clientId: f.clientId,
        fleetId: fleet.id,
        riderId: rider.id,
        agreementId: agreement.id,
        returnRequestId: request.id,
        allocationId: allocation.id,
        inspectionId: inspection.id,
        hubId: f.hub.id,
        assetSnapshot: {},
        requiredPhotoTypes: [],
        createdById: f.manager.id,
      },
    });
    const photo = await db.photo.create({
      data: {
        clientId: f.clientId,
        workFlowType: 'FLEET_ALLOTMENT', subjectType: 'INSPECTION', entityId: inspection.id,
        photoType: 'OTHER',
        objectKey: randomUUID(),
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        uploadedById: f.manager.id,
        status: 'COMPLETE',
      },
    });
    const data = {
      clientId: f.clientId,
      submissionId: submission.id,
      requestKey: 'basic',
      stage: 'BASIC',
      mechanicName: 'Mechanic',
      summary: 'Tyre worn',
      safeForReuse: false,
      unsafeReason: 'Replace tyre',
      checksComplete: true,
      evidencePhotoIds: [photo.id],
      items: [],
      totalAmount: 0,
      currency: 'INR',
      digest: 'a'.repeat(64),
      status: 'POSTED',
      recordedById: f.manager.id,
      confirmedAt: new Date(),
      confirmedById: f.manager.id,
      riderBypassReason: 'Test',
      teamLeadBypassReason: 'Test',
    };
    const report = await db.vehicleSubmissionReport.create({ data });
    await db.vehicleSubmissionReport.create({
      data: {
        ...data,
        requestKey: 'draft',
        stage: 'DEEP',
        status: 'DRAFT',
        summary: 'Private draft',
      },
    });
    const list = await service.list(f.clientId, f.manager.id, query());
    expect(list.items[0].latestMechanicReport?.id).toBe(report.id);
    const detail = await service.get(f.clientId, f.manager.id, fleet.id);
    expect(detail.mechanicReports).toHaveLength(1);
    expect(detail.evidencePhotos.map((p) => p.id)).toEqual([photo.id]);
    expect(detail.latestMechanicReport).toMatchObject({
      summary: 'Tyre worn',
      unsafeReason: 'Replace tyre',
      mechanicName: 'Mechanic',
    });
    for (const key of [
      'digest',
      'riderOtpRequestId',
      'teamLeadOtpRequestId',
      'riderBypassReason',
      'totalAmount',
      'items',
    ])
      expect(detail.latestMechanicReport).not.toHaveProperty(key);
  });
});
