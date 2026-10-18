import { AllocationTeamLeadService } from './allocation-team-lead.service.js';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DeploymentCommercialService } from './deployment-commercial.service.js';
import { CommercialOfferService } from '../rider-rate-cards/commercial-offer.service.js';
import { CommercialLifecycleService } from '../rider-rate-cards/commercial-lifecycle.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';
import {
  sha256,
  pricingHash,
} from '../rider-rate-cards/commercial-snapshot.js';
import { AllocationsService } from './allocations.service.js';
import { MobileDeploymentService } from './mobile-deployment.service.js';
import { RideReturnsService } from '../ride-returns/ride-returns.service.js';
import { RiderBillingEngineService } from '../rider-billing/rider-billing-engine.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { RiderRateCardsService } from '../rider-rate-cards/rider-rate-cards.service.js';
import { AuditService } from '../audit/audit.service.js';

const url = process.env.DEPLOYMENT_PLAN_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
afterAll(() => db.$disconnect());
const pricing = new CommercialOfferService(db as never);
const deposits = new RiderDepositService(db as never);
const lifecycle = new CommercialLifecycleService(
  db as never,
  pricing,
  deposits,
);
const commercial = new DeploymentCommercialService(
  db as never,
  pricing,
  lifecycle,
  deposits,
);
const allocations = new AllocationsService(db as never, commercial);
const mobile = new MobileDeploymentService(
  db as never,
  allocations,
  {} as never,
  {} as never,
  commercial,
);
const returns = new RideReturnsService(
  db as never,
  allocations,
  {} as never,
  {} as never,
);
const billing = new RiderBillingEngineService(
  db as never,
  new RiderPaymentsService(db as never),
);

describe.skipIf(!url)(
  'allocation plan, payment, handover and return in PostgreSQL',
  () => {
    async function fixture(zero = false) {
      const key = randomUUID();
      const client = await db.client.create({
        data: { name: 'Plans', slug: key, status: 'ACTIVE' },
      });
      const user = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Rider',
          mobile: '9876543210',
          role: 'RIDER',
        },
      });
      const manager = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Manager',
          mobile: '9876543211',
          role: 'FLEET_MANAGER',
        },
      });
      const hub = await db.hub.create({
        data: {
          clientId: client.id,
          code: 'HUB',
          name: 'Hub',
          city: 'Gurugram',
          supportsDeallocation: true,
        },
      });
      await db.userHub.create({
        data: { clientId: client.id, userId: manager.id, hubId: hub.id },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          userId: user.id,
          name: 'Rider',
          mobile: user.mobile,
          status: 'ACTIVE',
        },
      });
      const leadUser = await db.user.create({ data: { clientId: client.id, name: 'Lead', mobile: '9876543212', role: 'TEAM_LEAD' } });
      const lead = await db.teamLeaderProfile.create({ data: { clientId: client.id, userId: leadUser.id } });
      await db.teamLeaderRider.create({ data: { clientId: client.id, riderId: rider.id, teamLeaderId: lead.id } });
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
      const fleet = await db.fleet.create({
        data: {
          clientId: client.id,
          fleetCode: 'SCOOTER',
          chassisNumber: key,
          oemId: oem.id,
          vehicleCategoryId: category.id,
          vehicleTypeId: type.id,
          speedType: 'SLOW_SPEED',
          currentHubId: hub.id,
          status: 'AVAILABLE',
          onboardingStatus: 'ACTIVE',
          manufacturingYear: 2020,
          manufacturingMonth: 1,
        },
      });
      const pkg = await db.package.create({
        data: { code: key, name: 'No training' },
      });
      await db.clientSubscription.create({
        data: {
          clientId: client.id,
          packageId: pkg.id,
          billingCycle: 'MONTHLY',
          startDate: new Date('2020-01-01'),
          status: 'ACTIVE',
        },
      });
      const card = await db.riderRateCard.create({
        data: {
          clientId: client.id,
          code: 'STANDARD',
          name: 'Standard',
          status: 'ACTIVE',
        },
      });
      const version = await db.riderRateCardVersion.create({
        data: {
          clientId: client.id,
          rateCardId: card.id,
          version: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date('2020-01-01'),
        },
      });
      await db.rateCardRentalRate.create({
        data: {
          clientId: client.id,
          rateCardVersionId: version.id,
          rentalPeriodType: 'DAILY',
          amount: zero ? '0' : '100',
        },
      });
      await db.rateCardDeposit.create({
        data: {
          clientId: client.id,
          rateCardVersionId: version.id,
          code: 'SCOOTER_SECURITY',
          name: 'Scooter security',
          depositType: 'VEHICLE_SECURITY',
          amount: zero ? '0' : '1000',
        },
      });
      if (!zero)
        await db.rateCardAdjustment.create({
          data: {
            clientId: client.id,
            rateCardVersionId: version.id,
            code: 'OLDER_SCOOTER_HUB',
            adjustmentType: 'VEHICLE_AGE',
            calculationType: 'FIXED_AMOUNT',
            target: 'DEPOSIT',
            targetDepositCode: 'SCOOTER_SECURITY',
            amount: '200',
            city: 'Gurugram',
            hubId: hub.id,
            minVehicleAgeMonths: 12,
          },
        });
      await db.rateCardFee.createMany({
        data: [
          {
            clientId: client.id,
            rateCardVersionId: version.id,
            code: 'ONBOARD_DEFAULT',
            name: 'Onboarding',
            chargeType: 'ONBOARDING_FEE',
            nature: 'ONE_TIME',
            eligibility: 'ONCE_PER_CLIENT_RIDER_RELATIONSHIP',
            amount: zero ? '0' : '100',
          },
          ...(!zero
            ? [
                {
                  clientId: client.id,
                  rateCardVersionId: version.id,
                  code: 'ONBOARD_HUB_AGE',
                  name: 'Onboarding',
                  chargeType: 'ONBOARDING_FEE',
                  nature: 'ONE_TIME' as const,
                  eligibility: 'ONCE_PER_CLIENT_RIDER_RELATIONSHIP' as const,
                  amount: '50',
                  city: 'Gurugram',
                  hubId: hub.id,
                  minVehicleAgeMonths: 12,
                },
              ]
            : []),
        ],
      });
      await db.riderCommercialTerms.create({
        data: {
          clientId: client.id,
          code: 'RENTAL',
          title: 'Rental terms',
          version: 1,
          content: 'Terms',
          contentHash: sha256('Terms'),
          status: 'ACTIVE',
        },
      });
      await db.riderTaxProfile.create({
        data: {
          clientId: client.id,
          supplierState: 'Haryana',
          placeOfSupply: 'Haryana',
          rules: {
            create: [
              {
                clientId: client.id,
                taxCode: 'EXEMPT',
                chargeType: 'RENTAL',
                effectiveFrom: new Date('2020-01-01'),
              },
              {
                clientId: client.id,
                taxCode: 'EXEMPT',
                chargeType: 'ONBOARDING_FEE',
                effectiveFrom: new Date('2020-01-01'),
              },
            ],
          },
        },
      });
      const allocation = await allocations.initiate(
        client.id,
        fleet.id,
        rider.id,
        manager.id,
      );
      const actor = {
        id: manager.id,
        clientId: client.id,
        roles: [UserRole.FLEET_MANAGER],
      };
      const riderActor = {
        id: user.id,
        clientId: client.id,
        roles: [UserRole.RIDER],
      };
      const select = async () => {
        const [selected, retry] = await Promise.all([
          commercial.createOffer(
            client.id,
            actor,
            allocation.id,
            { rateCardVersionId: version.id, rentalPeriodType: 'DAILY' },
            'select-plan-1',
          ),
          commercial.createOffer(
            client.id,
            actor,
            allocation.id,
            { rateCardVersionId: version.id, rentalPeriodType: 'DAILY' },
            'select-plan-1',
          ),
        ]);
        expect(selected.offer?.id).toBe(retry.offer?.id);
        const offer = selected.offer!;
        const [agreement, retried] = await Promise.all([
          lifecycle.acceptOffer(
            client.id,
            user.id,
            offer.id,
            { consent: true, acceptedTermsVersion: offer.termsVersion },
            rider.id,
          ),
          lifecycle.acceptOffer(
            client.id,
            user.id,
            offer.id,
            { consent: true, acceptedTermsVersion: offer.termsVersion },
            rider.id,
          ),
        ]);
        expect(agreement.id).toBe(retried.id);
        return { offer, agreement };
      };
      const pay = async () => {
        await mobile.requestFleet(client.id, manager.id, allocation.id);
        const p = (await mobile.askPayment(
          client.id,
          manager.id,
          allocation.id,
        )) as {
          id: string;
          status: string;
          amount: { toFixed(n: number): string };
        };
        if (p.status !== 'PAID') {
          await mobile.submitPaymentReference(
            client.id,
            user.id,
            allocation.id,
            'UPI',
            randomUUID(),
          );
          await Promise.all([
            mobile.verifyPayment(client.id, manager.id, allocation.id),
            mobile.verifyPayment(client.id, manager.id, allocation.id),
          ]);
        }
        return p;
      };
      const handover = async () => {
        await mobile.submitPdi(
          client.id,
          manager.id,
          allocation.id,
          'Partner',
          [{ code: 'FRONT', mandatory: true }],
        );
        return mobile.acceptPdi(client.id, user.id, allocation.id, [
          { code: 'FRONT', accepted: true },
        ]);
      };
      return {
        client,
        lead,
        user,
        manager,
        actor,
        riderActor,
        hub,
        rider,
        fleet,
        card,
        version,
        allocation,
        select,
        pay,
        handover,
      };
    }

    it('requires an active primary Team Lead for both mobile and staff handover', async () => {
      const f = await fixture(true);
      await f.select();
      await f.pay();
      await db.teamLeaderRider.updateMany({ where: { clientId: f.client.id }, data: { isPrimary: false } });
      await expect(f.handover()).rejects.toMatchObject({ response: { code: 'ALLOCATION_TEAM_LEAD_REQUIRED' } });
      await expect(allocations.activate(f.client.id, f.allocation.id)).rejects.toMatchObject({ response: { code: 'ALLOCATION_TEAM_LEAD_REQUIRED' } });
      expect((await db.allocation.findUniqueOrThrow({ where: { id: f.allocation.id } })).status).toBe('OTP_PENDING');
      const teams = new AllocationTeamLeadService(db as never);
      await teams.assign(f.client.id, f.manager.id, f.allocation.id, f.lead.id);
      await allocations.activate(f.client.id, f.allocation.id);
      expect((await db.allocation.findUniqueOrThrow({ where: { id: f.allocation.id } })).status).toBe('ACTIVE');
    });

    it('assigns one primary Team Lead under concurrent requests and preserves OTP eligibility', async () => {
      const f = await fixture(true);
      const user = await db.user.create({ data: { clientId: f.client.id, name: 'Second Lead', mobile: '9876543213', role: 'TEAM_LEAD' } });
      const lead = await db.teamLeaderProfile.create({ data: { clientId: f.client.id, userId: user.id } });
      const teams = new AllocationTeamLeadService(db as never);
      const list = await teams.list(f.client.id, 'Second', 1, 25);
      expect(list.data.map((l) => l.id)).toEqual([lead.id]);
      await Promise.all([teams.assign(f.client.id, f.manager.id, f.allocation.id, f.lead.id), teams.assign(f.client.id, f.manager.id, f.allocation.id, lead.id)]);
      const primary = await db.teamLeaderRider.findMany({ where: { clientId: f.client.id, riderId: f.rider.id, isPrimary: true, isActive: true, removedAt: null } });
      expect(primary).toHaveLength(1);
      expect((await teams.get(f.client.id, f.manager.id, f.allocation.id)).teamLead?.id).toBe(primary[0]!.teamLeaderId);
      const before = primary[0]!.assignedAt;
      await teams.assign(f.client.id, f.manager.id, f.allocation.id, primary[0]!.teamLeaderId);
      expect((await db.teamLeaderRider.findUniqueOrThrow({ where: { id: primary[0]!.id } })).assignedAt).toEqual(before);
    });

    it('rejects inaccessible allocations and inactive/foreign Team Leads', async () => {
      const f = await fixture(true);
      const other = await fixture(true);
      const teams = new AllocationTeamLeadService(db as never);
      await expect(teams.assign(f.client.id, other.manager.id, f.allocation.id, f.lead.id)).rejects.toThrow('assigned Hub');
      await expect(teams.assign(f.client.id, f.manager.id, f.allocation.id, other.lead.id)).rejects.toThrow('Active Team Lead not found');
      await db.user.update({ where: { id: f.lead.userId }, data: { isActive: false } });
      expect((await teams.list(f.client.id, undefined, 1, 25)).data).toHaveLength(0);
      await expect(teams.assign(f.client.id, f.manager.id, f.allocation.id, f.lead.id)).rejects.toThrow('Active Team Lead not found');
      await expect(db.$transaction((tx) => commercial.activateInTransaction(tx, f.client.id, f.allocation.id, new Date()))).rejects.toMatchObject({ response: { code: 'ALLOCATION_TEAM_LEAD_REQUIRED' } });
      await db.user.update({ where: { id: f.lead.userId }, data: { isActive: true } });
      await db.allocation.update({ where: { id: f.allocation.id }, data: { status: 'COMPLETED' } });
      await expect(teams.assign(f.client.id, f.manager.id, f.allocation.id, f.lead.id)).rejects.toThrow('in progress');
    });

    it('quotes scoped/versioned prices, credits payment once, activates both records and allows an immediate date-only return', async () => {
      const f = await fixture();
      const plans = await commercial.plans(
        f.client.id,
        f.actor,
        f.allocation.id,
      );
      expect(plans.items).toHaveLength(1);
      expect(plans.items[0]).toMatchObject({
        recurringAmount: '100.00',
        refundableAmount: '1200.00',
        payableToday: '1350.00',
      });
      const { agreement, offer } = await f.select();
      expect(agreement.status).toBe('PENDING_ACTIVATION');
      expect(
        await db.riderAgreementCommercialVersion.findFirst({
          where: { agreementId: agreement.id },
        }),
      ).toMatchObject({ status: 'PENDING', billingStartAt: null });
      const retry = await commercial.createOffer(
        f.client.id,
        f.actor,
        f.allocation.id,
        { rateCardVersionId: f.version.id, rentalPeriodType: 'DAILY' },
        'select-plan-1',
      );
      expect(retry.offer?.id).toBe(offer.id);
      const payment = await f.pay();
      expect(payment.amount.toFixed(2)).toBe('1350.00');
      await mobile.verifyPayment(f.client.id, f.manager.id, f.allocation.id);
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      expect(
        await db.riderDepositTransaction.count({
          where: { clientId: f.client.id, transactionType: 'COLLECTION' },
        }),
      ).toBe(1);
      await f.handover();
      const allocation = await db.allocation.findUniqueOrThrow({
        where: { id: f.allocation.id },
      });
      const active = await db.riderRentalAgreement.findUniqueOrThrow({
        where: { id: agreement.id },
      });
      expect(allocation.status).toBe('ACTIVE');
      expect(active.status).toBe('ACTIVE');
      expect(active.activatedAt).toEqual(allocation.allocatedAt);
      expect(allocation.rentalAgreementId).toBe(active.id);
      const schedule = await db.riderBillingSchedule.findUniqueOrThrow({
        where: { agreementId: active.id },
      });
      expect(schedule.anchorAt).toEqual(allocation.allocatedAt);
      const invoice = await billing.generate(
        f.client.id,
        schedule.id,
        f.manager.id,
      );
      expect(invoice.totalAmount.toFixed(2)).toBe('150.00');
      expect(invoice.outstandingAmount.toFixed(2)).toBe('0.00');
      expect(invoice.status).toBe('PAID');
      const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Kolkata',
      });
      const requested = await returns.request(
        f.client.id,
        f.riderActor,
        { plannedReturnDate: today },
        'return-immediately-1',
        'RIDER',
      );
      expect(requested).toMatchObject({
        allocationId: allocation.id,
        agreementId: active.id,
        plannedHubId: f.hub.id,
        status: 'REQUESTED',
      });
      expect(
        (
          await db.allocation.findUniqueOrThrow({
            where: { id: allocation.id },
          })
        ).status,
      ).toBe('ACTIVE');
    });

    it('rejects payment and handover without an accepted rental plan', async () => {
      const f = await fixture();
      await mobile.requestFleet(f.client.id, f.manager.id, f.allocation.id);
      await expect(
        mobile.askPayment(f.client.id, f.manager.id, f.allocation.id),
      ).rejects.toMatchObject({ response: { code: 'RENTAL_PLAN_REQUIRED' } });
      await db.inspection.updateMany({
        where: { allocationId: f.allocation.id },
        data: { status: 'COMPLETED' },
      });
      await db.allocation.update({
        where: { id: f.allocation.id },
        data: { status: 'OTP_PENDING' },
      });
      await expect(
        allocations.activate(f.client.id, f.allocation.id),
      ).rejects.toMatchObject({ response: { code: 'RENTAL_PLAN_REQUIRED' } });
      expect(
        (await db.fleet.findUniqueOrThrow({ where: { id: f.fleet.id } }))
          .status,
      ).toBe('RESERVED');
    });

    it('permits explicit zero pricing without a fake payment reference', async () => {
      const f = await fixture(true);
      await f.select();
      const p = await f.pay();
      expect(p.status).toBe('PAID');
      expect(p.amount.toFixed(2)).toBe('0.00');
      await f.handover();
      expect(
        (
          await db.allocation.findUniqueOrThrow({
            where: { id: f.allocation.id },
          })
        ).status,
      ).toBe('ACTIVE');
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(0);
    });

    it('prevents fleet managers or riders accessing another client/hub allocation', async () => {
      const f = await fixture();
      await expect(
        commercial.plans(
          f.client.id,
          { ...f.actor, id: randomUUID() },
          f.allocation.id,
        ),
      ).rejects.toThrow('not found');
      await expect(
        commercial.plans(randomUUID(), f.actor, f.allocation.id),
      ).rejects.toThrow('not found');
      await expect(
        commercial.getOffer(
          f.client.id,
          { ...f.riderActor, id: randomUUID() },
          f.allocation.id,
          true,
        ),
      ).rejects.toThrow('not found');
    });

    it('rolls back agreement activation and the billing schedule when scooter handover fails', async () => {
      const f = await fixture();
      const { agreement } = await f.select();
      await f.pay();
      await db.fleet.update({
        where: { id: f.fleet.id },
        data: { status: 'MAINTENANCE' },
      });
      await expect(f.handover()).rejects.toThrow('no longer reserved');
      expect(
        await db.riderRentalAgreement.findUnique({
          where: { id: agreement.id },
        }),
      ).toMatchObject({ status: 'PENDING_ACTIVATION', activatedAt: null });
      expect(
        await db.riderBillingSchedule.count({
          where: { agreementId: agreement.id },
        }),
      ).toBe(0);
    });

    it('requires explicit fee and deposit configuration instead of silently treating missing rules as zero', async () => {
      const f = await fixture();
      await db.rateCardFee.deleteMany({
        where: { rateCardVersionId: f.version.id },
      });
      await expect(
        commercial.plans(f.client.id, f.actor, f.allocation.id),
      ).rejects.toMatchObject({
        response: { code: 'ONBOARDING_FEE_NOT_CONFIGURED' },
      });
      await db.rateCardAdjustment.deleteMany({
        where: { rateCardVersionId: f.version.id },
      });
      await db.rateCardDeposit.deleteMany({
        where: { rateCardVersionId: f.version.id },
      });
      await expect(
        commercial.plans(f.client.id, f.actor, f.allocation.id),
      ).rejects.toMatchObject({
        response: { code: 'VEHICLE_DEPOSIT_NOT_CONFIGURED' },
      });
    });

    it('publishes adjacent effective versions while rejecting edits to published fee rules', async () => {
      const f = await fixture();
      const service = new RiderRateCardsService(
        db as never,
        new AuditService(db as never),
      );
      await expect(
        service.addChild(f.client.id, f.manager.id, f.version.id, 'fees', {
          code: 'EDIT',
          name: 'Fee',
          chargeType: 'ONBOARDING_FEE',
          nature: 'ONE_TIME',
          amount: '1',
        }),
      ).rejects.toThrow('immutable');
      const boundary = new Date('2099-01-01');
      await db.riderRateCardVersion.update({
        where: { id: f.version.id },
        data: { effectiveTo: boundary },
      });
      const next = await db.riderRateCardVersion.create({
        data: {
          clientId: f.client.id,
          rateCardId: f.card.id,
          version: 2,
          effectiveFrom: boundary,
        },
      });
      await db.rateCardRentalRate.create({
        data: {
          clientId: f.client.id,
          rateCardVersionId: next.id,
          rentalPeriodType: 'DAILY',
          amount: '100',
        },
      });
      expect(
        (await service.activateVersion(f.client.id, f.manager.id, next.id))
          .status,
      ).toBe('ACTIVE');
    });

    it('does not charge the onboarding fee again for an existing rental and preserves the accepted version', async () => {
      const f = await fixture();
      await f.select();
      await f.pay();
      await f.handover();
      const preview = await pricing.calculate(f.client.id, {
        riderId: f.rider.id,
        vehicleId: f.fleet.id,
        rateCardVersionId: f.version.id,
        rentalPeriodType: 'DAILY',
      });
      expect(preview.oneTimeCharges).toHaveLength(0);
      expect(preview.feeDecisions[0].included).toBe(false);
      await db.riderRateCardVersion.update({
        where: { id: f.version.id },
        data: { status: 'INACTIVE' },
      });
      const second = await db.riderRateCardVersion.create({
        data: {
          clientId: f.client.id,
          rateCardId: f.card.id,
          version: 2,
          status: 'ACTIVE',
          effectiveFrom: new Date('2020-01-01'),
        },
      });
      await db.rateCardRentalRate.create({
        data: {
          clientId: f.client.id,
          rateCardVersionId: second.id,
          rentalPeriodType: 'DAILY',
          amount: '999',
        },
      });
      const active = await db.riderRentalAgreement.findFirstOrThrow({
        where: { clientId: f.client.id },
      });
      expect(active.rateCardVersionId).toBe(f.version.id);
      expect(active.finalRecurringAmount.toFixed(2)).toBe('100.00');
    });

    it('reports a setup mismatch clearly rather than claiming an allocated scooter is missing', async () => {
      const f = await fixture();
      await f.select();
      await f.pay();
      await f.handover();
      await db.allocation.update({
        where: { id: f.allocation.id },
        data: { rentalAgreementId: null },
      });
      const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Kolkata',
      });
      await expect(
        returns.request(
          f.client.id,
          f.riderActor,
          { plannedReturnDate: today, plannedHubId: f.hub.id },
          'mismatch-return-1',
          'RIDER',
        ),
      ).rejects.toMatchObject({
        response: { code: 'ALLOCATION_AGREEMENT_MISMATCH' },
      });
    });

    it('retains the accepted exchange agreement and reconciled deposit without collecting onboarding again', async () => {
      const f = await fixture();
      const { agreement } = await f.select();
      await f.pay();
      await f.handover();
      const active = await db.riderRentalAgreement.findUniqueOrThrow({
        where: { id: agreement.id },
      });
      const {
        id: _id,
        createdAt: _created,
        updatedAt: _updated,
        metadata: _metadata,
        ...fleetData
      } = f.fleet;
      const replacement = await db.fleet.create({
        data: {
          ...fleetData,
          fleetCode: 'REPLACEMENT',
          chassisNumber: randomUUID(),
          status: 'AVAILABLE',
        },
      });
      await db.rateCardFee.updateMany({
        where: { rateCardVersionId: f.version.id },
        data: { eligibility: 'EVERY_NEW_AGREEMENT' },
      });
      const snapshot = await pricing.calculate(
        f.client.id,
        {
          riderId: f.rider.id,
          vehicleId: replacement.id,
          rateCardVersionId: f.version.id,
          rentalPeriodType: 'DAILY',
        },
        false,
        active.id,
      );
      expect(snapshot.oneTimeCharges).toHaveLength(0);
      const hash = pricingHash(
        f.client.id,
        snapshot,
        active.termsHash,
        active.termsVersion,
      );
      const exchange = await db.vehicleExchangeRequest.create({
        data: {
          clientId: f.client.id,
          agreementId: active.id,
          riderId: f.rider.id,
          oldVehicleId: f.fleet.id,
          replacementVehicleId: replacement.id,
          baseVersionNumber: 1,
          reasonCode: 'REPLACEMENT',
          status: 'HANDOVER_PENDING',
          createdById: f.manager.id,
        },
      });
      const amendment = await db.riderRentalAgreementAmendment.create({
        data: {
          clientId: f.client.id,
          agreementId: active.id,
          amendmentNumber: 1,
          exchangeRequestId: exchange.id,
          reason: 'Replacement',
          previousPricingHash: active.pricingHash,
          proposedPricingHash: hash,
          proposedPricingSnapshot: snapshot,
          status: 'ACCEPTED',
          createdById: f.manager.id,
        },
      });
      await db.vehicleExchangeOffer.create({
        data: {
          clientId: f.client.id,
          exchangeRequestId: exchange.id,
          status: 'ACCEPTED',
          pricingSnapshot: snapshot,
          pricingHash: hash,
          commercialDifference: {
            exchangeFee: '0.00',
            proration: { newCharge: '0.00', oldCredit: '0.00' },
          },
          offerHash: hash,
          termsSnapshot: active.termsSnapshot,
          termsTitle: active.termsTitle,
          termsHash: active.termsHash,
          termsVersion: active.termsVersion,
          expiresAt: new Date(Date.now() + 600000),
          createdById: f.manager.id,
        },
      });
      await db.riderAgreementCommercialVersion.create({
        data: {
          clientId: f.client.id,
          agreementId: active.id,
          versionNumber: 2,
          vehicleId: replacement.id,
          rateCardVersionId: f.version.id,
          pricingSnapshot: snapshot,
          pricingHash: hash,
          termsVersion: active.termsVersion,
          termsHash: active.termsHash,
          termsSnapshot: active.termsSnapshot,
          termsTitle: active.termsTitle,
          recurringAmount: snapshot.totals.recurringAmount,
          effectiveFrom: new Date(),
          status: 'PENDING',
          amendmentId: amendment.id,
        },
      });
      const [target] = await db.$transaction((tx) =>
        deposits.initializeInTransaction(
          tx,
          {
            ...active,
            vehicleId: replacement.id,
            pricingSnapshot: snapshot,
            pricingHash: hash,
          },
          f.manager.id,
          amendment.id,
          true,
        ),
      );
      const source = await db.riderDeposit.findFirstOrThrow({
        where: {
          clientId: f.client.id,
          agreementId: active.id,
          sourceType: 'RENTAL_AGREEMENT',
        },
      });
      await deposits.transfer(
        f.client.id,
        f.manager.id,
        {
          sourceDepositId: source.id,
          targetDepositId: target.id,
          amount: target.requiredAmount.toFixed(2),
          reason: 'Exchange deposit transfer',
        },
        'exchange-deposit-transfer-1',
      );
      await db.allocation.update({
        where: { id: f.allocation.id },
        data: { status: 'COMPLETED' },
      });
      await db.riderRentalAgreement.update({
        where: { id: active.id },
        data: { currentVehicleId: null },
      });
      const allocation = await allocations.initiate(
        f.client.id,
        replacement.id,
        f.rider.id,
        f.manager.id,
        `exchange:${exchange.id}`,
      );
      await db.vehicleExchangeRequest.update({
        where: { id: exchange.id },
        data: { newAllocationId: allocation.id },
      });
      await mobile.requestFleet(f.client.id, f.manager.id, allocation.id);
      const payment = await mobile.askPayment(
        f.client.id,
        f.manager.id,
        allocation.id,
      );
      expect(payment.amount.toFixed(2)).toBe('0.00');
      await mobile.submitPdi(
        f.client.id,
        f.manager.id,
        allocation.id,
        'Partner',
        [{ code: 'FRONT', mandatory: true }],
      );
      await mobile.acceptPdi(f.client.id, f.user.id, allocation.id, [
        { code: 'FRONT', accepted: true },
      ]);
      const retained = await db.riderRentalAgreement.findUniqueOrThrow({
        where: { id: active.id },
      });
      expect(retained.activatedAt).toEqual(active.activatedAt);
      expect(
        await db.riderRentalAgreement.count({
          where: { clientId: f.client.id },
        }),
      ).toBe(1);
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      expect(
        await db.allocation.findUnique({ where: { id: allocation.id } }),
      ).toMatchObject({ status: 'ACTIVE', rentalAgreementId: active.id });
    });
  },
);
