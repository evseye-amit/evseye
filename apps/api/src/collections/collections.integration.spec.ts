import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CollectionsService } from './collections.service.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { RiderPaymentsService } from '../rider-billing/rider-payments.service.js';

const enabled = !!process.env.PHASE8_TEST_DATABASE_URL;
describe.skipIf(!enabled)('collections with PostgreSQL', () => {
  it('reuses a case, tracks partial payment, fulfills a promise, and removes its restriction on payment', async () => {
    const db = new PrismaClient({
      datasources: { db: { url: process.env.PHASE8_TEST_DATABASE_URL! } },
    });
    try {
      const suffix = randomUUID().slice(0, 8);
      const client = await db.client.create({
        data: { name: `Phase 8 ${suffix}`, slug: `phase8-${suffix}` },
      });
      const user = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Collector',
          mobile: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          role: 'CLIENT_ADMIN',
        },
      });
      const approver = await db.user.create({
        data: {
          clientId: client.id,
          name: 'Approver',
          mobile: `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          role: 'CLIENT_ADMIN',
        },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          name: 'Test Rider',
          mobile: `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
          status: 'ACTIVE',
        },
      });
      const today = new Date();
      const dueDate = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - 5,
        ),
      );
      const invoice = await db.riderInvoice.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          invoiceNumber: `TEST/${suffix}`,
          billingPeriodStart: new Date(dueDate.getTime() - 7 * 86400000),
          billingPeriodEnd: dueDate,
          subtotal: 1000,
          creditAmount: 0,
          taxAmount: 0,
          totalAmount: 1000,
          outstandingAmount: 1000,
          currency: 'INR',
          dueDate,
          status: 'FINALIZED',
          issuedAt: dueDate,
          finalizedAt: dueDate,
        },
      });
      const service = new CollectionsService(
        db as never,
        {} as never,
        new RiderBillingService(db as never),
      );
      await service.createPolicy(client.id, user.id, {
        code: 'STANDARD',
        name: 'Standard',
        effectiveFrom: new Date(dueDate.getTime() - 86400000)
          .toISOString()
          .slice(0, 10),
        gracePeriodDays: 2,
        dunningEnabled: true,
        promiseToPayEnabled: true,
        promiseHoldEnabled: true,
        restrictionEnabled: true,
        lateFeeEnabled: true,
        maximumMessagesPerDay: 5,
        minimumMessageIntervalHours: 0,
        communicationStartHour: 0,
        communicationEndHour: 24,
        stages: [
          {
            stageCode: 'REVIEW',
            daysFromDue: 3,
            actions: ['COMMERCIAL_RESTRICTION_REVIEW', 'PUSH_NOTIFICATION'],
          },
        ],
      });
      const [caseId, concurrentCaseId] = await Promise.all([
        service.evaluate(client.id, rider.id, today),
        service.evaluate(client.id, rider.id, today),
      ]);
      expect(caseId).toBeTruthy();
      expect(concurrentCaseId).toBe(caseId);
      expect(await service.evaluate(client.id, rider.id, today)).toBe(caseId);
      await expect(
        service.summary(randomUUID(), rider.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await db.auditLog.count({
          where: { clientId: client.id, action: 'COLLECTION_CASE_OPENED' },
        }),
      ).toBe(1);
      expect(
        await db.riderCollectionCase.count({
          where: {
            clientId: client.id,
            riderId: rider.id,
            activeRiderId: rider.id,
          },
        }),
      ).toBe(1);
      await service.processActions(10, today);
      expect(
        await db.collectionTask.count({
          where: { clientId: client.id, caseId: caseId! },
        }),
      ).toBe(1);
      expect(
        await db.collectionAction.count({
          where: {
            clientId: client.id,
            caseId: caseId!,
            actionType: 'PUSH_NOTIFICATION',
            status: 'READY',
          },
        }),
      ).toBe(1);
      expect(
        (await service.riderSummary(client.id, rider.id)).reminders,
      ).toHaveLength(1);
      await service.setLateFeePolicy(client.id, user.id, {
        enabled: true,
        feeType: 'FIXED',
        amount: '50',
        minimumDaysPastDue: 3,
      });
      const fee = await service.applyLateFee(
        client.id,
        caseId!,
        user.id,
        today,
      );
      expect(
        (await service.applyLateFee(client.id, caseId!, user.id, today)).id,
      ).toBe(fee.id);
      expect(
        await db.riderCharge.count({
          where: { clientId: client.id, chargeType: 'LATE_FEE' },
        }),
      ).toBe(1);
      const waiver = await service.waiver(client.id, caseId!, user.id, {
        waiverType: 'LATE_FEE',
        amount: '50',
        reason: 'Approved fee exception',
      });
      await expect(
        service.approveWaiver(client.id, waiver.id, user.id),
      ).rejects.toMatchObject({ status: 409 });
      await service.approveWaiver(client.id, waiver.id, approver.id);
      await service.applyWaiver(client.id, waiver.id, approver.id);
      expect(
        await db.riderCredit.count({
          where: { clientId: client.id, referenceId: waiver.id },
        }),
      ).toBe(1);
      expect(
        (
          await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
        ).outstandingAmount.toString(),
      ).toBe('1000');
      const promiseDate = new Date(today.getTime() + 2 * 86400000)
        .toISOString()
        .slice(0, 10);
      const promise = await service.promise(
        client.id,
        caseId!,
        user.id,
        'OPERATIONS',
        { promisedAmount: '750', promiseDate },
      );
      expect(promise.status).toBe('ACTIVE');
      const payments = new RiderPaymentsService(db as never);
      const payment = await payments.record(
        client.id,
        rider.id,
        user.id,
        `payment:${suffix}:1`,
        { amount: '500', currency: 'INR', method: 'CASH' },
      );
      await payments.allocate(client.id, rider.id, payment.id, user.id, {
        policy: 'SPECIFIC_INVOICE',
        invoiceId: invoice.id,
      });
      await service.runQueue();
      expect(
        (await db.promiseToPay.findUniqueOrThrow({ where: { id: promise.id } }))
          .status,
      ).toBe('PARTIALLY_FULFILLED');
      expect(
        (
          await db.riderCollectionCase.findUniqueOrThrow({
            where: { id: caseId! },
          })
        ).totalOutstanding.toString(),
      ).toBe('500');
      await expect(
        service.restriction(
          client.id,
          caseId!,
          user.id,
          'BLOCK_NEW_VEHICLE_ALLOCATION',
          true,
          'Repeated non-payment',
        ),
      ).rejects.toMatchObject({ status: 409 });
      const promisePayment = await payments.record(
        client.id,
        rider.id,
        user.id,
        `payment:${suffix}:promise`,
        { amount: '250', currency: 'INR', method: 'CASH' },
      );
      await payments.allocate(client.id, rider.id, promisePayment.id, user.id, {
        policy: 'SPECIFIC_INVOICE',
        invoiceId: invoice.id,
      });
      await service.runQueue();
      expect(
        (await db.promiseToPay.findUniqueOrThrow({ where: { id: promise.id } }))
          .status,
      ).toBe('FULFILLED');
      const restriction = await service.restriction(
        client.id,
        caseId!,
        user.id,
        'BLOCK_NEW_VEHICLE_ALLOCATION',
        true,
        'Repeated non-payment',
      );
      expect(
        (
          await service.eligibility(
            client.id,
            rider.id,
            'BLOCK_NEW_VEHICLE_ALLOCATION',
          )
        ).allowed,
      ).toBe(false);
      const final = await payments.record(
        client.id,
        rider.id,
        user.id,
        `payment:${suffix}:2`,
        { amount: '250', currency: 'INR', method: 'CASH' },
      );
      await payments.allocate(client.id, rider.id, final.id, user.id, {
        policy: 'SPECIFIC_INVOICE',
        invoiceId: invoice.id,
      });
      await service.runQueue();
      expect(
        (await db.promiseToPay.findUniqueOrThrow({ where: { id: promise.id } }))
          .status,
      ).toBe('FULFILLED');
      expect(
        (
          await db.riderCollectionCase.findUniqueOrThrow({
            where: { id: caseId! },
          })
        ).status,
      ).toBe('RESOLVED');
      expect(
        (
          await db.commercialRestriction.findUniqueOrThrow({
            where: { id: restriction.id },
          })
        ).status,
      ).toBe('REMOVED');
      expect(
        (
          await service.eligibility(
            client.id,
            rider.id,
            'BLOCK_NEW_VEHICLE_ALLOCATION',
          )
        ).allowed,
      ).toBe(true);
      expect(
        (
          await new RiderBillingService(db as never).reconcile(
            client.id,
            rider.id,
          )
        ).reconciled,
      ).toBe(true);
    } finally {
      await db.$disconnect();
    }
  }, 30000);
});
