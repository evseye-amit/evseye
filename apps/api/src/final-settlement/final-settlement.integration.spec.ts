import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FinalSettlementService } from './final-settlement.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { RiderBillingEngineService } from '../rider-billing/rider-billing-engine.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';
import { RiderDepositService } from '../rider-deposits/deposit.service.js';

const enabled = !!process.env.PHASE9_TEST_DATABASE_URL;
const at = (s: string) => new Date(s);
describe.skipIf(!enabled)('final settlement in PostgreSQL', () => {
  it('reconciles final rental, damage, credit, deposit application, refund, and closure', async () => {
    const db = new PrismaClient({
      datasources: { db: { url: process.env.PHASE9_TEST_DATABASE_URL! } },
    });
    try {
      const suffix = randomUUID().slice(0, 8);
      const client = await db.client.create({
        data: { name: `Phase9 ${suffix}`, slug: `phase9-${suffix}` },
      });
      const maker = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Maker',
          mobile: `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          role: 'CLIENT_ADMIN',
        },
      });
      const checker = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Checker',
          mobile: `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          role: 'CLIENT_ADMIN',
        },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          name: 'Rider',
          mobile: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          status: 'ACTIVE',
        },
      });
      const snapshot = {
        currency: 'INR',
        rental: { period: 'WEEKLY', finalAmount: '1400.00' },
        oneTimeCharges: [],
      };
      const hash = 'a'.repeat(64);
      const termHash = 'b'.repeat(64);
      const offer = await db.riderCommercialOffer.create({
        data: {
          clientId: client.id,
          offerNumber: `EVO-2025-${suffix}`,
          riderId: rider.id,
          vehicleId: 'vehicle',
          rateCardId: 'historical-card',
          rateCardVersionId: 'historical-v1',
          rentalPeriodType: 'WEEKLY',
          effectiveDate: at('2025-10-01T00:00:00Z'),
          currency: 'INR',
          status: 'ACCEPTED',
          finalRecurringAmount: 1400,
          upfrontAmount: 3000,
          refundableAmount: 3000,
          pricingSnapshot: snapshot,
          calculationHash: hash,
          selectionHash: hash,
          termsVersion: '1',
          termsTitle: 'Terms',
          termsSnapshot: 'Agreed terms',
          termsHash: termHash,
          expiresAt: at('2027-11-01T00:00:00Z'),
          createdById: maker.id,
        },
      });
      const agreement = await db.riderRentalAgreement.create({
        data: {
          clientId: client.id,
          agreementNumber: `EVRA-2025-${suffix}`,
          commercialOfferId: offer.id,
          riderId: rider.id,
          vehicleId: 'vehicle',
          currentVehicleId: 'vehicle',
          rateCardId: 'historical-card',
          rateCardVersionId: 'historical-v1',
          rentalPeriodType: 'WEEKLY',
          currency: 'INR',
          startDate: at('2025-10-01T00:00:00Z'),
          status: 'TERMINATED',
          finalRecurringAmount: 1400,
          upfrontAmount: 3000,
          refundableAmount: 3000,
          pricingSnapshot: snapshot,
          pricingSnapshotSchemaVersion: 1,
          pricingHash: hash,
          termsSnapshot: 'Agreed terms',
          termsVersion: '1',
          termsTitle: 'Terms',
          termsHash: termHash,
          acceptedAt: at('2025-10-01T00:00:00Z'),
          acceptedById: maker.id,
          acceptanceMethod: 'OPERATIONS_ASSISTED',
          terminationEffectiveAt: at('2025-10-10T00:00:00Z'),
          terminatedAt: at('2025-10-10T00:00:00Z'),
          createdById: maker.id,
        },
      });
      await db.rentalTerminationRequest.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          agreementId: agreement.id,
          requestedTerminationDate: at('2025-10-10T00:00:00Z'),
          actualTerminationDate: at('2025-10-10T00:00:00Z'),
          reasonCode: 'VEHICLE_RETURN',
          requestedById: maker.id,
          status: 'RETURNED',
          idempotencyKey: `return-${suffix}`,
        },
      });
      await db.riderAgreementCommercialVersion.create({
        data: {
          clientId: client.id,
          agreementId: agreement.id,
          versionNumber: 1,
          vehicleId: 'vehicle',
          rateCardVersionId: 'historical-v1',
          pricingSnapshot: snapshot,
          pricingHash: hash,
          termsVersion: '1',
          termsHash: termHash,
          termsSnapshot: 'Agreed terms',
          termsTitle: 'Terms',
          recurringAmount: 1400,
          effectiveFrom: at('2025-10-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
      await db.riderPaymentProfile.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          currency: 'INR',
          billingMode: 'POSTPAID',
        },
      });
      await db.riderBillingSchedule.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          agreementId: agreement.id,
          frequency: 'WEEKLY',
          billingMode: 'POSTPAID',
          anchorType: 'AGREEMENT_START',
          anchorAt: at('2025-10-01T00:00:00Z'),
          timezone: 'UTC',
          nextPeriodStart: at('2025-10-08T00:00:00Z'),
        },
      });
      const tax = await db.riderTaxProfile.create({
        data: {
          clientId: client.id,
          supplierState: 'Haryana',
          placeOfSupply: 'Haryana',
        },
      });
      await db.riderTaxRule.createMany({
        data: ['RENTAL', 'DAMAGE'].map((chargeType) => ({
          clientId: client.id,
          profileId: tax.id,
          taxCode: 'GST_ZERO',
          chargeType,
          effectiveFrom: at('2025-01-01T00:00:00Z'),
        })),
      });
      const invoice = await db.riderInvoice.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          agreementId: agreement.id,
          invoiceNumber: `EXISTING-${suffix}`,
          billingPeriodStart: at('2025-10-01T00:00:00Z'),
          billingPeriodEnd: at('2025-10-08T00:00:00Z'),
          subtotal: 500,
          creditAmount: 0,
          totalAmount: 500,
          outstandingAmount: 500,
          currency: 'INR',
          status: 'FINALIZED',
          issuedAt: at('2025-10-08T00:00:00Z'),
          finalizedAt: at('2025-10-08T00:00:00Z'),
          dueDate: at('2025-10-08T00:00:00Z'),
        },
      });
      const deposit = await db.riderDeposit.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          agreementId: agreement.id,
          obligationKey: `security-${suffix}`,
          depositType: 'RIDER_SECURITY',
          code: 'SECURITY',
          currency: 'INR',
          originalRequiredAmount: 3000,
          requiredAmount: 3000,
          fundedAmount: 0,
          availableAmount: 0,
          sourceId: agreement.id,
          snapshotLine: { type: 'RIDER_SECURITY' },
        },
      });
      const deposits = new RiderDepositService(db as never);
      await deposits.move(
        client.id,
        maker.id,
        deposit.id,
        { amount: '3000.00', reason: 'Confirmed opening deposit' },
        `collect-${suffix}`,
        'COLLECTION',
      );
      const billing = new RiderBillingService(db as never);
      const service = new FinalSettlementService(
        db as never,
        billing,
        new RiderBillingEngineService(db as never),
        new RiderPaymentsService(db as never),
        deposits,
        {} as never,
      );
      await service.setPolicy(client.id, checker.id, {
        depositApplicationEnabled: true,
        manualDepositRefundEnabled: true,
      });
      const [settlement, concurrent] = await Promise.all([
        service.create(client.id, agreement.id, maker.id),
        service.create(client.id, agreement.id, maker.id),
      ]);
      expect(concurrent.id).toBe(settlement.id);
      expect(
        await db.riderFinalSettlement.count({
          where: { agreementId: agreement.id },
        }),
      ).toBe(1);
      await expect(
        service.get(randomUUID(), settlement.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await service.preview(client.id, agreement.id)).finalRentalEstimate,
      ).toBe('400.00');
      const damage = await service.assess(client.id, settlement.id, maker.id, {
        chargeType: 'DAMAGE',
        description: 'Damaged accessory',
        amount: '800.00',
        sourceType: 'INSPECTION',
        sourceId: 'inspection-1',
      });
      await service.decideCharge(
        client.id,
        settlement.id,
        damage.id,
        checker.id,
        true,
      );
      await service.issueNote(
        client.id,
        settlement.id,
        checker.id,
        `credit-${suffix}`,
        {
          kind: 'CREDIT',
          reasonCode: 'SERVICE_DOWNTIME',
          description: 'Service credit',
          amount: '200.00',
        },
      );
      await service.approve(client.id, settlement.id, checker.id);
      const billed = await db.riderInvoice.findMany({
        where: { clientId: client.id, agreementId: agreement.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(billed.map((i) => i.totalAmount.toFixed(2)).sort()).toEqual([
        '1000.00',
        '500.00',
      ]);
      expect(
        (await service.preview(client.id, agreement.id)).estimatedDeduction,
      ).toBe('1500.00');
      await service.applyDeposit(
        client.id,
        settlement.id,
        deposit.id,
        checker.id,
        '1500.00',
        'Approved final settlement',
      );
      expect(
        (
          await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
        ).outstandingAmount.toFixed(2),
      ).toBe('0.00');
      const refund = await service.requestRefund(
        client.id,
        settlement.id,
        deposit.id,
        checker.id,
        `refund-${suffix}`,
        'MANUAL_BANK_TRANSFER',
      );
      expect(refund.amount.toFixed(2)).toBe('1500.00');
      expect(
        (
          await service.requestRefund(
            client.id,
            settlement.id,
            deposit.id,
            checker.id,
            `refund-${suffix}`,
            'MANUAL_BANK_TRANSFER',
          )
        ).id,
      ).toBe(refund.id);
      expect(
        await db.riderDepositRefundRequest.count({
          where: { clientId: client.id, depositId: deposit.id },
        }),
      ).toBe(1);
      await expect(
        service.close(client.id, settlement.id, checker.id),
      ).rejects.toMatchObject({
        response: { code: 'FINANCIAL_CLOSURE_PENDING' },
      });
      await service.completeRefund(
        client.id,
        settlement.id,
        refund.id,
        checker.id,
        `bank-${suffix}`,
      );
      const payments = new RiderPaymentsService(db as never);
      const excess = await payments.record(
        client.id,
        rider.id,
        maker.id,
        `excess-${suffix}`,
        {
          amount: '500.00',
          currency: 'INR',
          method: 'BANK_TRANSFER',
          externalReference: `receipt-${suffix}`,
        },
      );
      const part = await service.requestManualExcessRefund(
        client.id,
        settlement.id,
        excess.id,
        checker.id,
        `part-${suffix}`,
        '200.00',
      );
      await service.completeManualExcessRefund(
        client.id,
        settlement.id,
        part.id,
        checker.id,
        `bank-part-${suffix}`,
      );
      expect(
        (
          await db.riderPayment.findUniqueOrThrow({ where: { id: excess.id } })
        ).unallocatedAmount.toFixed(2),
      ).toBe('300.00');
      const remainder = await service.requestManualExcessRefund(
        client.id,
        settlement.id,
        excess.id,
        checker.id,
        `remainder-${suffix}`,
        '300.00',
      );
      await service.completeManualExcessRefund(
        client.id,
        settlement.id,
        remainder.id,
        checker.id,
        `bank-remainder-${suffix}`,
      );
      expect(
        (
          await db.riderPayment.findUniqueOrThrow({ where: { id: excess.id } })
        ).refundedAmount.toFixed(2),
      ).toBe('500.00');
      await service.reconcile(client.id, settlement.id);
      expect(
        (await service.close(client.id, settlement.id, checker.id)).status,
      ).toBe('SETTLED');
      expect(
        (
          await db.riderRentalAgreement.findUniqueOrThrow({
            where: { id: agreement.id },
          })
        ).commercialClosureState,
      ).toBe('FINANCIALLY_CLOSED');
      expect(
        (
          await db.riderDeposit.findUniqueOrThrow({ where: { id: deposit.id } })
        ).availableAmount.toFixed(2),
      ).toBe('0.00');
    } finally {
      await db.$disconnect();
    }
  });
});
