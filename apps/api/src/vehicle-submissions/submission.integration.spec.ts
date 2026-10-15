import { RideReturnsService } from '../ride-returns/ride-returns.service.js';
import { VehicleExchangeService } from '../vehicle-exchanges/vehicle-exchange.service.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { VehicleSubmissionService } from './submission.service.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { AuthService } from '../auth/auth.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';

const url = process.env.SUBMISSION_TEST_DATABASE_URL;
describe.skipIf(!url)('vehicle submission in PostgreSQL', () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const prisma = db as PrismaService;
  const sms = { send: vi.fn().mockResolvedValue(undefined) };
  const settings: Record<string, unknown> = {
    NODE_ENV: 'development',
    SMS_PROVIDER: 'console',
    OTP_HASH_SECRET: 'submission-test-secret-32-characters',
    OTP_TTL_SECONDS: 300,
    OTP_MAX_ATTEMPTS: 2,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
  };
  const auth = new AuthService(
    prisma,
    {} as never,
    {
      getOrThrow: (key: string) => settings[key],
      get: (key: string) => settings[key],
    } as never,
    sms as never,
    {} as never,
    {} as never,
  );
  const allocations = new AllocationsService(prisma);
  const service = new VehicleSubmissionService(
    prisma,
    allocations,
    auth,
    new RiderBillingService(prisma),
  );
  afterAll(() => db.$disconnect());

  async function fixture(source: 'RETURN' | 'EXCHANGE' = 'RETURN') {
    const suffix = randomUUID();
    const client = await db.client.create({
      data: { name: 'Submission test', slug: suffix },
    });
    const mobile = () =>
      `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const fm = await db.user.create({
      data: {
        clientId: client.id,
        name: 'Fleet Manager',
        mobile: mobile(),
        role: 'FLEET_MANAGER',
      },
    });
    const lead = await db.user.create({
      data: {
        clientId: client.id,
        name: 'Team Lead',
        mobile: mobile(),
        role: 'TEAM_LEAD',
      },
    });
    const riderUser = await db.user.create({
      data: {
        clientId: client.id,
        name: 'Rider',
        mobile: mobile(),
        role: 'RIDER',
      },
    });
    const rider = await db.rider.create({
      data: {
        clientId: client.id,
        userId: riderUser.id,
        name: 'Rider',
        mobile: riderUser.mobile,
        status: 'ACTIVE',
      },
    });
    const profile = await db.teamLeaderProfile.create({
      data: { clientId: client.id, userId: lead.id },
    });
    await db.teamLeaderRider.create({
      data: {
        clientId: client.id,
        riderId: rider.id,
        teamLeaderId: profile.id,
      },
    });
    const hub = await db.hub.create({
      data: {
        clientId: client.id,
        code: 'HOME',
        name: 'Home',
        latitude: 17,
        longitude: 78,
      },
    });
    await db.userHub.create({
      data: { clientId: client.id, userId: fm.id, hubId: hub.id },
    });
    const oem = await db.oem.create({
      data: { code: suffix, name: 'Maker', displayName: 'Maker' },
    });
    const category = await db.vehicleCategory.create({
      data: { code: suffix, name: 'Category' },
    });
    const type = await db.vehicleType.create({
      data: {
        code: suffix,
        name: 'Type',
        categoryId: category.id,
        energyType: 'ELECTRIC',
      },
    });
    const fleet = await db.fleet.create({
      data: {
        clientId: client.id,
        fleetCode: 'VEHICLE',
        chassisNumber: suffix,
        oemId: oem.id,
        vehicleCategoryId: category.id,
        vehicleTypeId: type.id,
        speedType: 'SLOW_SPEED',
        status: 'ALLOCATED',
        currentHubId: hub.id,
      },
    });
    const allocation = await db.allocation.create({
      data: {
        clientId: client.id,
        riderId: rider.id,
        fleetId: fleet.id,
        status: 'ACTIVE',
        initiatedById: fm.id,
        allocatedAt: new Date('2026-01-01'),
      },
    });
    const snapshot = {
      currency: 'INR',
      rental: { period: 'WEEKLY', finalAmount: '1400.00' },
      oneTimeCharges: [],
    };
    const offer = await db.riderCommercialOffer.create({
      data: {
        clientId: client.id,
        offerNumber: suffix,
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
        createdById: fm.id,
      },
    });
    const agreement = await db.riderRentalAgreement.create({
      data: {
        clientId: client.id,
        agreementNumber: suffix,
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
        acceptedById: fm.id,
        acceptanceMethod: 'OPERATIONS_ASSISTED',
        createdById: fm.id,
      },
    });
    const returns = new RideReturnsService(
      prisma,
      allocations,
      new RiderBillingService(prisma),
      auth,
    );
    const riderActor: AuthUser = {
      id: riderUser.id,
      clientId: client.id,
      roles: ['RIDER'],
    };
    if (source === 'EXCHANGE')
      await db.clientExchangePolicy.create({
        data: { clientId: client.id, exchangeAllowed: true },
      });
    const request =
      source === 'RETURN'
        ? await returns.request(
            client.id,
            riderActor,
            { plannedReturnDate: '2099-01-01' },
            suffix,
            'RIDER',
          )
        : await new VehicleExchangeService(
            prisma,
            {} as never,
            {} as never,
            allocations,
          ).request(
            client.id,
            riderUser.id,
            { plannedReturnDate: '2099-01-01' },
            rider.id,
          );
    expect(request.plannedHubId).toBe(hub.id);
    expect(request.submissionRequired).toBe(true);
    const actor: AuthUser = {
      id: fm.id,
      clientId: client.id,
      roles: ['FLEET_MANAGER'],
    };
    if (source === 'RETURN')
      await expect(
        returns.receive(client.id, actor, request.id, {
          receivedHubId: hub.id,
        }),
      ).rejects.toThrow('submission workflow');
    const submission = await service.start(
      client.id,
      actor,
      source,
      request.id,
    );
    const price = await db.returnPenaltyPrice.create({
      data: {
        clientId: client.id,
        code: 'DAMAGE',
        category: 'DAMAGE',
        description: 'Damage repair',
        amount: 100,
        currency: 'INR',
        createdById: fm.id,
      },
    });
    async function photo(photoType: string) {
      return db.photo.create({
        data: {
          clientId: client.id,
          entityType: 'INSPECTION',
          entityId: submission.inspectionId,
          photoType,
          objectKey: randomUUID(),
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          status: 'COMPLETE',
          uploadedById: fm.id,
          uploadedAt: new Date(),
        },
      });
    }
    async function capture() {
      return Promise.all(submission.requiredPhotoTypes.map(photo));
    }
    function report(
      proof: string,
      stage: 'BASIC' | 'DEEP' = 'BASIC',
      checksComplete = false,
    ) {
      return {
        stage,
        mechanicName: 'Mechanic',
        summary: 'Checked the vehicle and recorded repair findings',
        safeForReuse: true,
        checksComplete,
        evidencePhotoIds: [proof],
        items: [
          {
            priceId: price.id,
            quantity: 1,
            details: 'Cracked panel needs repair',
            evidencePhotoIds: [proof],
          },
        ],
      };
    }
    return {
      client,
      actor,
      rider,
      riderUser,
      lead,
      hub,
      fleet,
      allocation,
      agreement,
      request,
      submission,
      price,
      photo,
      capture,
      report,
    };
  }

  it('requires proof, binds both OTPs, posts initial and later charges once, and holds the vehicle until checks finish', async () => {
    const f = await fixture();
    const cid = f.client.id;
    const first = await f.photo('VEHICLE_FRONT');
    await expect(
      service.recordReport(
        cid,
        f.actor,
        f.submission.id,
        f.report(first.id),
        'basic-report',
      ),
    ).rejects.toThrow('Capture all');
    const photos = await f.capture();
    const proof = photos[0]!.id;
    await expect(
      service.recordReport(
        cid,
        f.actor,
        f.submission.id,
        {
          ...f.report(proof),
          items: [{ ...f.report(proof).items[0]!, evidencePhotoIds: [] }],
        },
        'missing-proof',
      ),
    ).rejects.toThrow('Every penalty');
    const basic = await service.recordReport(
      cid,
      f.actor,
      f.submission.id,
      f.report(proof),
      'basic-report',
    );
    expect(
      (
        await service.recordReport(
          cid,
          f.actor,
          f.submission.id,
          f.report(proof),
          'basic-report',
        )
      ).id,
    ).toBe(basic.id);
    await expect(
      service.recordReport(
        cid,
        f.actor,
        f.submission.id,
        { ...f.report(proof), summary: 'Different' },
        'basic-report',
      ),
    ).rejects.toThrow('different report');
    await expect(
      allocations.completeDeallocation(cid, f.allocation.id),
    ).rejects.toThrow('confirmation');
    await expect(
      db.fleet.update({
        where: { id: f.fleet.id },
        data: { status: 'AVAILABLE', allocationEnabled: true },
      }),
    ).rejects.toThrow();
    await service.impose(cid, f.actor, basic.id);
    await expect(service.confirm(cid, f.actor, basic.id, {})).rejects.toThrow(
      'Rider OTP',
    );
    const requests = await service.requestOtps(cid, f.actor, basic.id, 'BOTH');
    const otpFor = (party: string) =>
      (
        requests.recipients.find((entry) => entry.party === party) as {
          otpRequestId: string;
        }
      ).otpRequestId;
    expect(otpFor('RIDER')).toBeTruthy();
    expect(otpFor('TEAM_LEAD')).toBeTruthy();
    await expect(
      service.verifyOtp(
        cid,
        f.actor,
        basic.id,
        'RIDER',
        otpFor('RIDER'),
        '000000',
      ),
    ).rejects.toThrow('Invalid');
    expect(
      (
        await db.otpRequest.findUniqueOrThrow({
          where: { id: otpFor('RIDER') },
        })
      ).attempts,
    ).toBe(1);
    await service.verifyOtp(
      cid,
      f.actor,
      basic.id,
      'RIDER',
      otpFor('RIDER'),
      '123456',
    );
    await expect(
      service.verifyOtp(
        cid,
        f.actor,
        basic.id,
        'RIDER',
        otpFor('RIDER'),
        '123456',
      ),
    ).rejects.toThrow();
    await service.verifyOtp(
      cid,
      f.actor,
      basic.id,
      'TEAM_LEAD',
      otpFor('TEAM_LEAD'),
      '123456',
    );
    const confirmations = await Promise.all([
      service.confirm(cid, f.actor, basic.id, {}),
      service.confirm(cid, f.actor, basic.id, {}),
    ]);
    expect(confirmations.every((row) => row.status === 'POSTED')).toBe(true);
    expect(await db.riderCharge.count({ where: { clientId: cid } })).toBe(1);
    expect(
      (
        await db.rentalTerminationRequest.findUniqueOrThrow({
          where: { id: f.request.id },
        })
      ).status,
    ).toBe('RETURNED');
    expect(
      (
        await db.riderRentalAgreement.findUniqueOrThrow({
          where: { id: f.agreement.id },
        })
      ).status,
    ).toBe('TERMINATED');
    expect(
      (
        await db.allocation.findUniqueOrThrow({
          where: { id: f.allocation.id },
        })
      ).status,
    ).toBe('COMPLETED');
    expect(
      (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } })).status,
    ).toBe('MAINTENANCE');
    await expect(
      db.vehicleSubmissionReport.update({
        where: { id: basic.id },
        data: { summary: 'Tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      service.recordReport(
        cid,
        f.actor,
        f.submission.id,
        f.report(proof, 'DEEP'),
        'duplicate-finding',
      ),
    ).rejects.toThrow('charged twice');
    const laterProof = await f.photo('DEEP_PANEL_DAMAGE');
    const deep = await service.recordReport(
      cid,
      f.actor,
      f.submission.id,
      f.report(laterProof.id, 'DEEP', true),
      'deep-report',
    );
    await service.impose(cid, f.actor, deep.id);
    expect((await service.get(cid, f.actor, f.submission.id)).nextAction).toBe(
      'COLLECT_OTPS_OR_RECORD_BYPASS',
    );
    await expect(
      service.confirm(
        cid,
        { ...f.actor, roles: ['OPERATIONS_MANAGER'] },
        deep.id,
        {
          riderBypassReason: 'Unavailable',
          teamLeadBypassReason: 'Unavailable',
        },
      ),
    ).rejects.toThrow('Only a fleet manager');
    await service.confirm(cid, f.actor, deep.id, {
      riderBypassReason: 'Rider could not receive SMS; findings explained',
      teamLeadBypassReason: 'Team lead unavailable; notified of findings',
    });
    expect(
      await db.riderCharge.count({
        where: {
          clientId: cid,
          agreementId: f.agreement.id,
          vehicleId: f.fleet.id,
        },
      }),
    ).toBe(2);
    const released = await db.fleet.findUniqueOrThrow({
      where: { id: f.fleet.id },
    });
    expect(released.status).toBe('AVAILABLE');
    expect(released.allocationEnabled).toBe(true);
    expect((await service.get(cid, f.actor, f.submission.id)).nextAction).toBe(
      'COMPLETE',
    );
    await expect(
      service.cancelReport(cid, f.actor, deep.id, 'Undo'),
    ).rejects.toThrow('posted report');
  }, 30000);

  it('completes exchange intake without terminating the agreement and restricts hub and rider access', async () => {
    const f = await fixture('EXCHANGE');
    const cid = f.client.id;
    await expect(
      service.get(cid, { ...f.actor, id: randomUUID() }, f.submission.id),
    ).rejects.toThrow('assigned hub');
    await expect(
      service.get(
        cid,
        { ...f.actor, id: randomUUID(), roles: ['RIDER'] },
        f.submission.id,
      ),
    ).rejects.toThrow('not found');
    const photos = await f.capture();
    const basic = await service.recordReport(
      cid,
      f.actor,
      f.submission.id,
      { ...f.report(photos[0]!.id), items: [], checksComplete: true },
      'exchange-basic',
    );
    await service.impose(cid, f.actor, basic.id);
    await db.teamLeaderRider.updateMany({
      where: { clientId: cid },
      data: { isActive: false },
    });
    const request = await service.requestOtps(
      cid,
      f.actor,
      basic.id,
      'TEAM_LEAD',
    );
    expect(request.recipients[0]!.available).toBe(false);
    await service.confirm(cid, f.actor, basic.id, {
      riderBypassReason: 'Rider phone unavailable',
      teamLeadBypassReason: 'No primary team lead assigned',
    });
    const agreement = await db.riderRentalAgreement.findUniqueOrThrow({
      where: { id: f.agreement.id },
    });
    expect(agreement.status).toBe('ACTIVE');
    expect(agreement.currentVehicleId).toBeNull();
    expect(
      (
        await db.vehicleExchangeRequest.findUniqueOrThrow({
          where: { id: f.request.id },
        })
      ).status,
    ).toBe('APPROVED');
    expect(await db.riderCharge.count({ where: { clientId: cid } })).toBe(0);
  }, 30000);
  it('persists OTP expiry and exhaustion, reports SMS failure, and scopes queue and proof access', async () => {
    const f = await fixture();
    const cid = f.client.id;
    const photos = await f.capture();
    const report = await service.recordReport(
      cid,
      f.actor,
      f.submission.id,
      { ...f.report(photos[0]!.id), items: [] },
      'otp-failures',
    );
    await service.impose(cid, f.actor, report.id);
    const req = await service.requestOtps(cid, f.actor, report.id, 'BOTH');
    const riderOtp = (
      req.recipients.find((r) => r.party === 'RIDER') as {
        otpRequestId: string;
      }
    ).otpRequestId;
    const leadOtp = (
      req.recipients.find((r) => r.party === 'TEAM_LEAD') as {
        otpRequestId: string;
      }
    ).otpRequestId;
    await db.otpRequest.update({
      where: { id: riderOtp },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      service.verifyOtp(cid, f.actor, report.id, 'RIDER', riderOtp, '123456'),
    ).rejects.toThrow('expired');
    expect(
      (await db.otpRequest.findUniqueOrThrow({ where: { id: riderOtp } }))
        .status,
    ).toBe('EXPIRED');
    await expect(
      service.verifyOtp(
        cid,
        f.actor,
        report.id,
        'TEAM_LEAD',
        leadOtp,
        '000000',
      ),
    ).rejects.toThrow('Invalid');
    await expect(
      service.verifyOtp(
        cid,
        f.actor,
        report.id,
        'TEAM_LEAD',
        leadOtp,
        '000000',
      ),
    ).rejects.toThrow('Invalid');
    expect(
      (await db.otpRequest.findUniqueOrThrow({ where: { id: leadOtp } }))
        .status,
    ).toBe('FAILED');
    await expect(
      service.verifyOtp(
        cid,
        f.actor,
        report.id,
        'TEAM_LEAD',
        leadOtp,
        '123456',
      ),
    ).rejects.toThrow();
    sms.send.mockRejectedValueOnce(new Error('Provider unavailable'));
    const failed = await service.requestOtps(cid, f.actor, report.id, 'RIDER');
    expect(failed.recipients[0]).toHaveProperty(
      'error',
      'SMS delivery is temporarily unavailable.',
    );
    const queue = await service.queue(cid, f.actor, 'RETURN', 'CHECKS', 1, 20);
    expect(queue.meta.total).toBe(1);
    expect(queue.data[0]!.rider?.name).toBe('Rider');
    expect(
      (
        await service.queue(
          cid,
          { ...f.actor, id: randomUUID() },
          'RETURN',
          'CHECKS',
          1,
          20,
        )
      ).meta.total,
    ).toBe(0);
    const riderActor: AuthUser = {
      id: f.riderUser.id,
      clientId: cid,
      roles: ['RIDER'],
    };
    expect(
      await service.authorizePhoto(
        cid,
        riderActor,
        f.submission.id,
        photos[0]!.id,
      ),
    ).toBe(photos[0]!.id);
    await expect(
      service.authorizePhoto(cid, riderActor, f.submission.id, randomUUID()),
    ).rejects.toThrow('proof not found');
    await expect(
      service.get(randomUUID(), f.actor, f.submission.id),
    ).rejects.toThrow('not found');
    await service.cancelReport(
      cid,
      f.actor,
      report.id,
      'Mechanic needs to correct report',
    );
    expect(
      (
        await db.inspection.findUniqueOrThrow({
          where: { id: f.submission.inspectionId },
        })
      ).status,
    ).toBe('DRAFT');
    await expect(
      service.confirm(cid, f.actor, report.id, {
        riderBypassReason: 'Unavailable',
        teamLeadBypassReason: 'Unavailable',
      }),
    ).rejects.toThrow('imposed');
  }, 30000);
});
