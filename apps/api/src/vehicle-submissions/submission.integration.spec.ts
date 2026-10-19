import { FleetManagerMaintenanceService } from '../fleet-manager-maintenance/maintenance.service.js';
import { MaintenanceFleetsQueryDto } from '../fleet-manager-maintenance/maintenance.dto.js';
import { MediaService } from '../media/media.service.js';
import { SparesService } from '../spares/spares.service.js';
import { pendingPenaltySummary, SubmissionPenaltyService } from '../submission-penalties/submission-penalty.service.js';
import { penaltyDebt, requirePenaltyClearance } from '../submission-penalties/penalty-accounting.js';
import { SubmissionPenaltyWorker } from '../submission-penalties/submission-penalty.worker.js';
import { NotificationService } from '../notifications/notification.service.js';
import { NotificationWorker } from '../notifications/notification.worker.js';
import { WalletService } from '../wallet/wallet.service.js';
import { WalletPolicyService } from '../wallet/wallet-policy.service.js';
import { WalletBillingService } from '../wallet/wallet-billing.service.js';
import { SecurityDepositService } from '../wallet/security-deposit.service.js';
import { CheckoutCollectionService } from '../payments/checkout-collection.service.js';
import { MockPaymentProvider } from '../payments/mock-payment.provider.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import { RideReturnsService } from '../ride-returns/ride-returns.service.js';
import { VehicleExchangeService } from '../vehicle-exchanges/vehicle-exchange.service.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { VehicleSubmissionService } from './submission.service.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { AuthService } from '../auth/auth.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MechanicReportDto } from './submission.dto.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';

const url = process.env.SUBMISSION_TEST_DATABASE_URL;
describe.skipIf(!url)('vehicle submission in PostgreSQL', () => {
  let db!: PrismaClient;
  let prisma!: PrismaService;
  const sms = { send: vi.fn().mockResolvedValue(undefined) };
  const settings: Record<string, unknown> = {
    NODE_ENV: 'development',
    SMS_PROVIDER: 'console',
    OTP_HASH_SECRET: 'submission-test-secret-32-characters',
    OTP_TTL_SECONDS: 300,
    OTP_MAX_ATTEMPTS: 2,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
  };
  let auth!: AuthService;
  let allocations!: AllocationsService;
  let service!: VehicleSubmissionService;
  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    prisma = db as PrismaService;
    auth = new AuthService(
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
    allocations = new AllocationsService(prisma, {} as never);
    service = new VehicleSubmissionService(
      prisma,
      allocations,
      auth,
      new RiderBillingService(prisma),
    );
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
  });

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
    await db.allocation.update({ where: { id: allocation.id }, data: { commercialOfferId: offer.id, rentalAgreementId: agreement.id } });
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
    ): MechanicReportDto {
      return {
        stage,
        fleetStatus: checksComplete ? 'AVAILABLE' : 'MAINTENANCE',
        issues: checksComplete ? [] : [{ category: 'BODY_CHASSIS', description: 'Repaired body panel; final checks pending', status: 'RESOLVED', evidencePhotoIds: [proof] }],
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


  it.each([{ fleetStatus: 'BROKEN', category: 'POWERTRAIN' }, { fleetStatus: 'AWAITING_PARTS', category: undefined }] as const)('confirms $fleetStatus with optional category, blocks release and resolves the issue through a deeper report', async ({ fleetStatus, category }) => {
    const f = await fixture();
    const photos = await f.capture();
    const proof = photos[0]!.id;
    const issueProof = await f.photo('POWERTRAIN_DETAIL');
    const findingId = randomUUID();
    const input: MechanicReportDto = {
      ...f.report(proof, 'BASIC', true), fleetStatus, safeForReuse: false,
      unsafeReason: 'Motor requires replacement', items: fleetStatus === 'BROKEN' ? [{ ...f.report(proof).items[0]!, findingId }] : [],
      issues: [{ category, description: 'Motor failure', status: 'OPEN',
        requiredParts: 'Motor assembly', penaltyFindingId: fleetStatus === 'BROKEN' ? findingId : undefined, evidencePhotoIds: [issueProof.id] }],
    };
    const report = await service.recordReport(f.client.id, f.actor, f.submission.id, input, 'condition-basic-key');
    expect((await service.recordReport(f.client.id, f.actor, f.submission.id, input, 'condition-basic-key')).id).toBe(report.id);
    await service.impose(f.client.id, f.actor, report.id);
    const replacement = await db.photo.create({ data: {
      clientId: f.client.id, entityType: 'INSPECTION', entityId: f.submission.inspectionId,
      photoType: issueProof.photoType, objectKey: randomUUID(), mimeType: 'image/jpeg',
      sizeBytes: 100, uploadedById: f.actor.id,
    } });
    await new MediaService(prisma, { assertObjectExists: vi.fn().mockResolvedValue(undefined) } as never).complete(f.client.id, replacement.id);
    expect((await db.photo.findUniqueOrThrow({ where: { id: issueProof.id } })).status).toBe('COMPLETE');

    expect(await db.vehicleMaintenanceIssue.count({ where: { fleetId: f.fleet.id } })).toBe(0);
    await service.confirm(f.client.id, f.actor, report.id, { riderBypassReason: 'Phone unavailable', teamLeadBypassReason: 'Phone unavailable' });
    const fleet = await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } });
    expect(fleet.status).toBe(fleetStatus);
    expect(fleet.allocationEnabled).toBe(false);
    const issue = await db.vehicleMaintenanceIssue.findFirstOrThrow({ where: { fleetId: f.fleet.id } });
    expect(issue.category).toBe(category ?? null);
    const maintenance = new FleetManagerMaintenanceService(prisma);
    const filtered = await maintenance.list(f.client.id, f.actor.id, Object.assign(new MaintenanceFleetsQueryDto(), { issueCategory: 'POWERTRAIN', fleetStatus }));
    expect(filtered.items.some(item => item.id === fleet.id)).toBe(category === 'POWERTRAIN');
    const unfiltered = await maintenance.list(f.client.id, f.actor.id, new MaintenanceFleetsQueryDto());
    expect(unfiltered.items.some(item => item.id === fleet.id)).toBe(true);
    const otherCategory = await maintenance.list(f.client.id, f.actor.id, Object.assign(new MaintenanceFleetsQueryDto(), { issueCategory: 'BRAKES' }));
    expect(otherCategory.items).toHaveLength(0);

    await expect(db.fleet.update({ where: { id: f.fleet.id }, data: { status: 'AVAILABLE', allocationEnabled: true } })).rejects.toThrow();
    const missingResolution = await service.recordReport(f.client.id, f.actor, f.submission.id,
      { ...f.report(proof, 'DEEP', true), items: [] }, 'missing-resolution-key');
    await service.impose(f.client.id, f.actor, missingResolution.id);
    await expect(service.confirm(f.client.id, f.actor, missingResolution.id, { riderBypassReason: 'Unavailable', teamLeadBypassReason: 'Unavailable' })).rejects.toThrow('Resolve all outstanding');
    await service.cancelReport(f.client.id, f.actor, missingResolution.id, 'Include outstanding issue resolution');
    const repaired = await service.recordReport(f.client.id, f.actor, f.submission.id, {
      ...f.report(proof, 'DEEP', true), items: [],
      issues: [{ issueId: issue.id, description: 'Motor replaced and tested', status: 'RESOLVED', penaltyFindingId: issue.penaltyFindingId ?? undefined, evidencePhotoIds: [proof] }],
    }, 'condition-repaired-key');
    await service.impose(f.client.id, f.actor, repaired.id);
    await service.confirm(f.client.id, f.actor, repaired.id, { riderBypassReason: 'Unavailable', teamLeadBypassReason: 'Unavailable' });
    const resolvedIssue = await db.vehicleMaintenanceIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(resolvedIssue.status).toBe('RESOLVED');
    expect(resolvedIssue.category).toBe(category ?? null);
    expect(resolvedIssue.penaltyFindingId).toBe(fleetStatus === 'BROKEN' ? findingId : null);
    expect(await db.riderCharge.count({ where: { clientId: f.client.id } })).toBe(fleetStatus === 'BROKEN' ? 1 : 0);
    expect((await db.fleet.findUniqueOrThrow({ where: { id: fleet.id } })).status).toBe('AVAILABLE');
    expect((await db.vehicleSubmissionReport.findUniqueOrThrow({ where: { id: report.id } })).fleetStatus).toBe(fleetStatus);
    expect(await db.fleetStatusHistory.count({ where: { fleetId: fleet.id, toStatus: fleetStatus } })).toBe(1);
  });

  async function finalizedPenalty() {
    const f = await fixture();
    await f.capture();
    const proof = await f.photo('PENALTY_DAMAGE');
    const report = await service.recordReport(f.client.id, f.actor, f.submission.id, f.report(proof.id, 'BASIC', true), 'penalty-payment-report');
    await service.impose(f.client.id, f.actor, report.id);
    const posted = await service.confirm(f.client.id, f.actor, report.id, { riderBypassReason: 'Recovery; rider unavailable', teamLeadBypassReason: 'Team lead notified of recovery' });
    const invoice = await db.riderInvoice.findFirstOrThrow({ where: { clientId: f.client.id, sourceKey: `submission-penalty:${report.id}` } });
    const wallet = new WalletService(prisma);
    const deposits = new SecurityDepositService(prisma, wallet, new WalletPolicyService(prisma));
    const walletBilling = new WalletBillingService(prisma, wallet, deposits);
    return { ...f, report, posted, invoice, wallet, walletBilling, deposits };
  }

  it('finishes recovery submission unpaid, persists the dialog and retries notifications without a device', async () => {
    const f = await finalizedPenalty();
    const cid = f.client.id;
    expect(f.posted.paymentRequest).toMatchObject({ invoiceId: f.invoice.id, outstandingAmount: '100.00', paymentStatus: 'PENDING' });
    expect((await db.allocation.findUniqueOrThrow({ where: { id: f.allocation.id } })).status).toBe('COMPLETED');
    expect((await db.riderRentalAgreement.findUniqueOrThrow({ where: { id: f.agreement.id } })).status).toBe('TERMINATED');
    const penalties = new SubmissionPenaltyService(prisma);
    const listing = await penalties.list(cid, f.rider.id, 1, 25);
    expect(listing.data).toHaveLength(1);
    expect(listing.data[0]!.breakdown).toMatchObject({ penalties: [expect.objectContaining({ amount: '100.00' })] });
    expect((await pendingPenaltySummary(prisma, cid, f.rider.id)).pendingCount).toBe(1);
    const again = await service.confirm(cid, f.actor, f.report.id, {});
    expect(again.paymentRequest?.invoiceId).toBe(f.invoice.id);
    expect(await db.riderInvoice.count({ where: { clientId: cid } })).toBe(1);
    expect(await db.riderLedgerEntry.count({ where: { clientId: cid, entryType: 'CHARGE' } })).toBe(1);
    await expect(db.$transaction((tx) => requirePenaltyClearance(tx, cid, f.rider.id, f.allocation.id))).rejects.toMatchObject({ response: { code: 'UNPAID_SUBMISSION_PENALTIES' } });
    await db.client.update({ where: { id: cid }, data: { status: 'ACTIVE' } });
    const failing = new SubmissionPenaltyWorker(prisma, { enqueueForUsers: vi.fn().mockRejectedValue(new Error('notification outage')) } as never);
    await failing.enqueuePending();
    expect((await db.riderInvoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).penaltyNotificationQueuedAt).toBeNull();
    expect((await db.vehicleSubmission.findUniqueOrThrow({ where: { id: f.submission.id } })).status).toBe('CONFIRMED');
    const notifications = new NotificationService(prisma, { getOrThrow: () => 3600 } as never, { configured: false } as never);
    const worker = new SubmissionPenaltyWorker(prisma, notifications);
    await worker.enqueuePending();
    await worker.enqueuePending();
    expect(await db.userNotification.count({ where: { clientId: cid, userId: f.riderUser.id } })).toBe(1);
    const push = new NotificationWorker(prisma, {} as never, notifications, { configured: false } as never);
    await push.expandRecipients();
    expect(await db.pushDelivery.count({ where: { message: { clientId: cid } } })).toBe(0);
    expect((await db.userNotification.findFirstOrThrow({ where: { clientId: cid } })).noActiveDevice).toBe(true);
  });

  it('settles penalties through verified checkout exactly once and records wallet and billing history', async () => {
    const f = await finalizedPenalty();
    const cid = f.client.id;
    const provider = new MockPaymentProvider();
    vi.spyOn(provider, 'fetchCheckoutPayments').mockImplementation(async (orderId) => [{ orderId, providerPaymentId: `paid-${orderId}`, status: 'SUCCESS', rawStatus: 'SUCCESS', amount: '100.00', currency: 'INR' }]);
    const checkout = new CheckoutCollectionService(prisma, { getOrThrow: () => 'mock', get: () => undefined } as never, provider, new RiderPaymentsService(prisma), new RiderDepositService(prisma), f.walletBilling, f.wallet, f.deposits);
    const order = await checkout.payInvoice(cid, f.rider.id, f.invoice.id, 'penalty-checkout-key', false, f.riderUser.id);
    expect(order.paymentSessionId).toBeTruthy();
    await checkout.verify(cid, f.rider.id, order.collectionId!);
    await checkout.verify(cid, f.rider.id, order.collectionId!);
    const invoice = await db.riderInvoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(invoice.status).toBe('PAID');
    expect(await db.riderPayment.count({ where: { clientId: cid } })).toBe(1);
    expect(await db.walletTransaction.count({ where: { clientId: cid, transactionType: 'PAYMENT' } })).toBe(1);
    expect(await db.riderLedgerEntry.count({ where: { clientId: cid, entryType: 'PAYMENT' } })).toBe(1);
    expect((await penaltyDebt(prisma, cid, f.rider.id)).hasDebt).toBe(false);
    await db.$transaction((tx) => requirePenaltyClearance(tx, cid, f.rider.id, f.allocation.id));
    expect((await new SubmissionPenaltyService(prisma).list(cid, f.rider.id, 1, 25)).data).toHaveLength(0);
    expect((await new SubmissionPenaltyService(prisma).list(cid, f.rider.id, 1, 25, true)).data[0]!.paymentStatus).toBe('PAID');
    const foreign = await fixture();
    await expect(new SubmissionPenaltyService(prisma).get(foreign.client.id, foreign.rider.id, f.invoice.id)).rejects.toThrow('not found');
  });

  it('supports partial wallet payments and reopens both ledgers when reversed', async () => {
    const f = await finalizedPenalty();
    const cid = f.client.id;
    const wallet = await f.wallet.ensure(cid, f.rider.id, f.riderUser.id);
    const accounts = await db.walletAccount.findMany({ where: { walletId: wallet.id } });
    const cash = accounts.find((a) => a.accountType === 'CASH')!;
    const clearing = accounts.find((a) => a.accountType === 'CLEARING')!;
    await f.wallet.post({ clientId: cid, walletId: wallet.id, actorId: f.riderUser.id, type: 'TOP_UP', amount: '40.00', currency: 'INR', description: 'Fund wallet', idempotencyKey: 'penalty-wallet-funding', entries: [{ accountId: cash.id, entryType: 'CREDIT', amount: '40.00' }, { accountId: clearing.id, entryType: 'DEBIT', amount: '40.00' }] });
    const result = await f.walletBilling.settle(cid, f.invoice.id, f.riderUser.id, 'wallet-penalty-payment');
    expect(result.outstandingAmount.toFixed(2)).toBe('60.00');
    await f.walletBilling.settle(cid, f.invoice.id, f.riderUser.id, 'wallet-penalty-payment');
    const transaction = await db.walletTransaction.findFirstOrThrow({ where: { clientId: cid, transactionType: 'PENALTY' } });
    expect(await db.riderLedgerEntry.count({ where: { clientId: cid, sourceType: 'WALLET_PENALTY_PAYMENT' } })).toBe(1);
    await f.walletBilling.reverse(cid, transaction.id, f.riderUser.id, 'reverse-penalty-payment');
    expect((await db.riderInvoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).outstandingAmount.toFixed(2)).toBe('100.00');
    expect(await db.riderLedgerEntry.count({ where: { clientId: cid, sourceType: 'WALLET_PENALTY_REVERSAL' } })).toBe(1);
    expect((await penaltyDebt(prisma, cid, f.rider.id)).hasDebt).toBe(true);
  });

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
    expect(await db.riderInvoice.count({ where: { clientId: cid, invoiceType: 'SUBMISSION_PENALTY' } })).toBe(2);
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
      { ...f.report(photos[0]!.id), items: [], checksComplete: true, fleetStatus: 'AVAILABLE' as const, issues: [] },
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
  it('routes a safe completed return back to preparation in QC mode and preserves an allocation block', async () => {
    const f=await fixture();
    await db.client.update({where:{id:f.client.id},data:{fleetOperatingMode:'PREPARATION_QC'}});
    await db.fleet.update({where:{id:f.fleet.id},data:{allocationEnabled:false,allocationBlockedByAdmin:true}});
    const proof=await f.photo('PENALTY_DAMAGE');
    await expect(service.recordReport(f.client.id,f.actor,f.submission.id,{...f.report(proof.id),items:[],checksComplete:true,fleetStatus:'AVAILABLE' as const,issues:[]},'qc-return')).rejects.toThrow('Capture all');
    const photos=await f.capture();
    const report=await service.recordReport(f.client.id,f.actor,f.submission.id,{...f.report(photos[0]!.id),items:[],checksComplete:true,fleetStatus:'AVAILABLE' as const,issues:[]},'qc-return');
    await service.impose(f.client.id,f.actor,report.id);
    await service.confirm(f.client.id,f.actor,report.id,{riderBypassReason:'Development test return',teamLeadBypassReason:'Development test return'});
    expect(await db.fleet.findUniqueOrThrow({where:{id:f.fleet.id}})).toMatchObject({status:'INSPECTION_PENDING',allocationEnabled:false,readinessApprovedPreparationId:null});
    expect(await db.allocation.findUniqueOrThrow({where:{id:f.allocation.id}})).toMatchObject({status:'COMPLETED'});
  });

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
  it('saves versioned client spare penalties, supports draft editing, and invoices at impose exactly once', async()=>{
    const f=await fixture();const photos=await f.capture();
    const admin=await db.user.create({data:{clientId:f.client.id,name:'Admin',mobile:'+919000000099',role:'CLIENT_ADMIN'}});
    const spares=new SparesService(prisma);const adminActor:AuthUser={id:admin.id,clientId:f.client.id,roles:['CLIENT_ADMIN']};
    const part=await spares.createClientSpare(f.client.id,adminActor,{code:'LOCAL_PANEL',name:'Body panel',baseRate:'120',gstPercent:'18',hsnCode:'12345678',unit:'PIECE',vehicleTypeIds:[],penaltyAmount:'200',evidenceRequired:false,isActive:true});
    const input={...f.report(photos[0]!.id),items:[{priceId:part.id,configurationVersion:part.version,findingType:'DAMAGE' as const,findingId:randomUUID(),quantity:2,details:'Two damaged panels',evidencePhotoIds:[]}]};
    const draft=await service.recordReport(f.client.id,f.actor,f.submission.id,input,'spare-draft-key');
    expect(await db.riderCharge.count({where:{clientId:f.client.id}})).toBe(0);expect(draft.totalAmount.toFixed(2)).toBe('400.00');
    const changed={...input,items:[{...input.items[0]!,quantity:1}]};
    const edited=await service.updateReport(f.client.id,f.actor,draft.id,changed,draft.digest);expect(edited.totalAmount.toFixed(2)).toBe('200.00');
    await expect(service.updateReport(f.client.id,f.actor,draft.id,{...changed,summary:'Concurrent stale edit'},draft.digest)).rejects.toThrow('changed');
    const imposed=await service.impose(f.client.id,f.actor,draft.id);expect(imposed.paymentRequest).toBeTruthy();
    expect(await db.riderCharge.count({where:{clientId:f.client.id}})).toBe(1);
    await expect(service.cancelReport(f.client.id,f.actor,draft.id,'Undo financial charge')).rejects.toThrow('financial');
    await expect(service.updateReport(f.client.id,f.actor,draft.id,changed,edited.digest)).rejects.toThrow('draft');
    const replacement=await db.photo.create({data:{clientId:f.client.id,entityType:'INSPECTION',entityId:f.submission.inspectionId,photoType:photos[0]!.photoType,objectKey:`test/${randomUUID()}`,mimeType:'image/jpeg',sizeBytes:10,uploadedById:f.actor.id}});
    const media=new MediaService(prisma,{assertObjectExists:vi.fn().mockResolvedValue(undefined)} as never);await media.complete(f.client.id,replacement.id);expect((await db.photo.findUniqueOrThrow({where:{id:photos[0]!.id}})).status).toBe('COMPLETE');
    const repeat=await service.impose(f.client.id,f.actor,draft.id);expect(repeat.paymentRequest?.invoiceId).toBe(imposed.paymentRequest?.invoiceId);
    await spares.updateClient(f.client.id,adminActor,part.id,{expectedVersion:1,reason:'Future penalty update',penaltyAmount:'999',evidenceRequired:true});
    const posted=await service.confirm(f.client.id,f.actor,draft.id,{riderBypassReason:'Recovery rider unavailable',teamLeadBypassReason:'Lead unavailable'});
    expect(posted.totalAmount.toFixed(2)).toBe('200.00');expect(await db.riderCharge.count({where:{clientId:f.client.id}})).toBe(1);
    const snapshot=(posted.items as unknown as {spare:{baseRate:string;hsnCode:string};evidenceRequired:boolean}[])[0]!;expect(snapshot.spare.baseRate).toBe('120.00');expect(snapshot.spare.hsnCode).toBe('12345678');expect(snapshot.evidenceRequired).toBe(false);
    const invoice=await db.riderInvoice.findFirstOrThrow({where:{clientId:f.client.id,invoiceType:'SUBMISSION_PENALTY'}});expect(invoice.totalAmount.toFixed(2)).toBe('200.00');expect(invoice.outstandingAmount.toFixed(2)).toBe('200.00');
  },30000);
  it('rejects stale catalogue versions and foreign or missing proofs while preserving mandatory report evidence',async()=>{
    const f=await fixture(),photos=await f.capture();const admin=await db.user.create({data:{clientId:f.client.id,name:'Admin',mobile:'+919000000099',role:'CLIENT_ADMIN'}});const actor:AuthUser={id:admin.id,clientId:f.client.id,roles:['CLIENT_ADMIN']};const spares=new SparesService(prisma);
    const part=await spares.createClientSpare(f.client.id,actor,{code:'PROOF_SPARE',name:'Required proof part',baseRate:'100',gstPercent:'18',hsnCode:'12345678',penaltyAmount:'150',evidenceRequired:true,isActive:true});
    const input={...f.report(photos[0]!.id),items:[{priceId:part.id,configurationVersion:part.version,quantity:1,details:'Damaged part',evidencePhotoIds:[] as string[]}]};
    await expect(service.recordReport(f.client.id,f.actor,f.submission.id,input,'required-spare-proof')).rejects.toThrow('Every penalty');
    await expect(service.recordReport(f.client.id,f.actor,f.submission.id,{...input,items:[{...input.items[0]!,evidencePhotoIds:[randomUUID()]}]},'foreign-spare-proof')).rejects.toThrow('Every penalty');
    await spares.updateClient(f.client.id,actor,part.id,{expectedVersion:1,reason:'Optional item proof',evidenceRequired:false});
    await expect(service.recordReport(f.client.id,f.actor,f.submission.id,input,'stale-spare-version')).rejects.toThrow('Refresh');
    await expect(service.recordReport(f.client.id,f.actor,f.submission.id,{...input,evidencePhotoIds:[],items:[{...input.items[0]!,configurationVersion:2}]},'required-report-proof')).rejects.toThrow('mechanic report needs proof');
    const saved=await service.recordReport(f.client.id,f.actor,f.submission.id,{...input,items:[{...input.items[0]!,configurationVersion:2,findingType:'MISSING_ITEM'}]},'optional-missing-proof');expect(saved.totalAmount.toFixed(2)).toBe('150.00');
  },30000);
  it('scopes submission catalogue to manager hubs and rejects repeated findings without photos',async()=>{
    const f=await fixture(),photos=await f.capture();const spares=new SparesService(prisma);const admin=await db.user.create({data:{clientId:f.client.id,name:'Admin',mobile:'+919000000099',role:'CLIENT_ADMIN'}});const part=await spares.createClientSpare(f.client.id,{id:admin.id,clientId:f.client.id,roles:['CLIENT_ADMIN']},{code:'DUPLICATE_PART',name:'Part',baseRate:'10',gstPercent:'0',hsnCode:'1234',penaltyAmount:'20',evidenceRequired:false,isActive:true});
    const outsider=await db.user.create({data:{clientId:f.client.id,name:'Other FM',mobile:'+919000000098',role:'FLEET_MANAGER'}});
    await expect(spares.catalogue(f.client.id,{id:outsider.id,clientId:f.client.id,roles:['FLEET_MANAGER']},{submissionId:f.submission.id})).rejects.toThrow('assigned hubs');
    expect((await spares.catalogue(f.client.id,f.actor,{submissionId:f.submission.id,search:'DUPLICATE_PART'})).data).toHaveLength(1);
    const item={priceId:part.id,configurationVersion:1,quantity:1,details:'Same damaged panel',evidencePhotoIds:[]};
    await expect(service.recordReport(f.client.id,f.actor,f.submission.id,{...f.report(photos[0]!.id),items:[{...item,findingId:randomUUID()},{...item,findingId:randomUUID()}]},'duplicate-no-proof')).rejects.toThrow('charged twice');
  },30000);

});
