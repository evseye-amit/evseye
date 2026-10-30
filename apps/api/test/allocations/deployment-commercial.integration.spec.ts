import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
import type { ExecutionContext } from '@nestjs/common';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { ExchangeHubGuard, type ExchangeHubRequest } from '../../src/vehicle-exchanges/exchange-hub.guard.js';
import { VehicleExchangeService } from '../../src/vehicle-exchanges/vehicle-exchange.service.js';
import { VehicleExchangeController } from '../../src/vehicle-exchanges/vehicle-exchange.controller.js';
import { CommonPaymentService } from '../../src/payments/common-payment.service.js';
import { CheckoutCollectionService } from '../../src/payments/checkout-collection.service.js';
import { PaymentTransactionsService } from '../../src/payment-transactions/payment-transactions.service.js';
import { MediaService } from '../../src/media/media.service.js';
import { SubmissionPenaltyService } from '../../src/submission-penalties/submission-penalty.service.js';
import { RiderBillingService } from '../../src/rider-billing/rider-billing.service.js';
import { AllocationTeamLeadService } from '../../src/allocations/allocation-team-lead.service.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RazorpayDeploymentService } from '../../src/payments/razorpay/razorpay-deployment.service.js';
import { RazorpayProviderError } from '../../src/payments/razorpay/razorpay.client.js';
import type { RazorpayClient, RazorpayPayment } from '../../src/payments/razorpay/razorpay.client.js';
import { PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DeploymentCommercialService } from '../../src/allocations/deployment-commercial.service.js';
import { CommercialOfferService } from '../../src/rider-rate-cards/commercial-offer.service.js';
import { CommercialLifecycleService } from '../../src/rider-rate-cards/commercial-lifecycle.service.js';
import { RiderDepositService } from '../../src/rider-deposits/deposit.service.js';
import {
  sha256,
  pricingHash,
} from '../../src/rider-rate-cards/commercial-snapshot.js';
import { AllocationsService } from '../../src/allocations/allocations.service.js';
import { MobileDeploymentService } from '../../src/allocations/mobile-deployment.service.js';
import { RideReturnsService } from '../../src/ride-returns/ride-returns.service.js';
import { RiderBillingEngineService } from '../../src/rider-billing/rider-billing-engine.service.js';
import { RiderPaymentsService } from '../../src/rider-billing/rider-payments.service.js';
import { RiderRateCardsService } from '../../src/rider-rate-cards/rider-rate-cards.service.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { FleetsService } from '../../src/fleets/fleets.service.js';
import { FleetStatusPolicy } from '../../src/fleets/fleet-status.policy.js';

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
const returns = new RideReturnsService(db as never);
const billing = new RiderBillingEngineService(
  db as never,
  new RiderPaymentsService(db as never),
);

describe.skipIf(!url)(
  'allocation plan, payment, handover and return in PostgreSQL',
  () => {
    async function razorpayFixture() {
      const f = await fixture();
      await f.select();
      await mobile.requestFleet(f.client.id, f.manager.id, f.allocation.id);
      const payment = await mobile.askPayment(f.client.id, f.manager.id, f.allocation.id);
      const remotes: RazorpayPayment[] = [];
      let remoteOrder: { id: string; amount: number; currency: string; receipt: string; status: string };
      const gateway = {
        enabled: true, keyId: 'rzp_test_fixture', assertConfigured: vi.fn(), verifyCheckout: vi.fn(), verifyWebhook: vi.fn(),
        createOrder: vi.fn(async (amount: number, currency: string, receipt: string) => remoteOrder = { id: `order_${randomUUID().replaceAll('-', '')}`, amount, currency, receipt, status: 'created' }),
        findOrders: vi.fn(async () => remoteOrder ? [remoteOrder] : []),
        fetchOrder: vi.fn(async () => remoteOrder),
        orderPayments: vi.fn(async (id: string) => remotes.filter(p => p.order_id === id)),
        fetchPayment: vi.fn(async (id: string) => remotes.find(p => p.id === id)!),
        findRefunds: vi.fn(async () => [] as Array<{ id: string; payment_id: string; amount: number; receipt: string; status: string }>),
        fetchRefund: vi.fn(),
        refund: vi.fn(async (id: string, amount: number, receipt: string) => ({ id: `rfnd_${randomUUID().replaceAll('-', '')}`, payment_id: id, amount, receipt, status: 'processed' })),
      };
      const service = new RazorpayDeploymentService(db as never, gateway as unknown as RazorpayClient, commercial);
      const order = await service.createOrder(f.client.id, f.user.id, f.allocation.id);
      const remote = { id: `pay_${randomUUID().replaceAll('-', '')}`, order_id: order.orderId, amount: order.amount, currency: order.currency, status: 'captured', captured: true, amount_refunded: 0 } as RazorpayPayment;
      const input = { razorpayOrderId: order.orderId!, razorpayPaymentId: remote.id, razorpaySignature: 'a'.repeat(64) };
      return { ...f, payment, gateway, remotes, service, order, remote, input };
    }

    it('Razorpay settles concurrent callbacks and webhooks once, including deposits and ledger', async () => {
      const f = await razorpayFixture();
      f.remotes.push(f.remote);
      await Promise.all([
        f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input),
        f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input),
        f.service.webhook(Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: f.remote.id, order_id: f.order.orderId } } } })), 'signature', randomUUID()),
      ]);
      await f.service.reconcile();
      expect(await db.deploymentPayment.findUnique({ where: { id: f.payment.id } })).toMatchObject({ status: 'PAID', provider: 'RAZORPAY', verifiedById: null });
      expect(await db.mobileDeploymentWorkflow.findUnique({ where: { allocationId: f.allocation.id } })).toMatchObject({ status: 'PAYMENT_PAID' });
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(1);
      expect(await db.riderLedgerEntry.count({ where: { clientId: f.client.id, entryType: 'PAYMENT' } })).toBe(1);
      expect(await db.riderDepositTransaction.count({ where: { clientId: f.client.id, transactionType: 'COLLECTION' } })).toBe(1);
      expect(await db.razorpayDeploymentCapture.count({ where: { providerPaymentId: f.remote.id } })).toBe(1);
      expect(f.gateway.refund).not.toHaveBeenCalled();
    }, 30000);
    it('Razorpay reuses orders, waits for capture, rejects wrong owners and mismatched amounts', async () => {
      const f = await razorpayFixture();
      expect(await f.service.createOrder(f.client.id, f.user.id, f.allocation.id)).toEqual(f.order);
      expect(f.gateway.createOrder).toHaveBeenCalledTimes(1);
      await expect(f.service.createOrder(f.client.id, randomUUID(), f.allocation.id)).rejects.toThrow('not found');
      await expect(f.service.verify(randomUUID(), f.user.id, f.allocation.id, f.input)).rejects.toThrow('not found');
      f.remotes.push({ ...f.remote, status: 'authorized', captured: false });
      expect(await f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input)).toMatchObject({ status: 'PENDING', nextAction: 'AWAITING_GATEWAY_CONFIRMATION' });
      f.remotes[0] = { ...f.remote, amount: 1 };
      await expect(f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input)).rejects.toThrow('does not match');
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(0);
    }, 30000);
    it('Razorpay records a late payment after manual approval and refunds it without duplicate credits', async () => {
      const f = await razorpayFixture();
      const reference = randomUUID();
      await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'CASH', reference);
      await mobile.verifyPayment(f.client.id, f.manager.id, f.allocation.id);
      f.remotes.push(f.remote);
      await expect(f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input)).rejects.toThrow('different payment');
      await f.service.reconcileAllocation(f.client.id, f.allocation.id);
      expect(await db.razorpayDeploymentCapture.findUnique({ where: { providerPaymentId: f.remote.id } })).toMatchObject({ status: 'REFUNDED', reason: 'DUPLICATE_PAYMENT' });
      expect(await db.deploymentPayment.findUnique({ where: { id: f.payment.id } })).toMatchObject({ provider: 'CASH', providerReference: reference });
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(1);
      expect(f.gateway.refund).toHaveBeenCalledTimes(1);
    }, 30000);
    it('Razorpay refunds a capture for a cancelled allocation without advancing the workflow', async () => {
      const f = await razorpayFixture();
      await db.allocation.update({ where: { id: f.allocation.id }, data: { status: 'CANCELLED' } });
      f.remotes.push(f.remote);
      expect(await f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input)).toMatchObject({ status: 'PENDING', gateway: { status: 'REFUND_PENDING' } });
      await f.service.reconcileAllocation(f.client.id, f.allocation.id);
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(0);
      expect(await db.razorpayDeploymentCapture.findUnique({ where: { providerPaymentId: f.remote.id } })).toMatchObject({ status: 'REFUNDED' });
    }, 30000);
    it('Razorpay keeps captured money visible for review if the saved amount changes', async () => {
      const f = await razorpayFixture();
      await db.deploymentPayment.update({ where: { id: f.payment.id }, data: { amount: 9999 } });
      f.remotes.push(f.remote);
      expect(await f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input)).toMatchObject({ status: 'PENDING', gateway: { status: 'REVIEW_REQUIRED', reason: 'PAYMENT_AMOUNT_CHANGED' } });
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(0);
      await expect(f.service.createOrder(f.client.id, f.user.id, f.allocation.id)).rejects.toThrow('already received');
    }, 30000);

    it('Razorpay recovers an ambiguous order create using the saved receipt without another create', async () => {
      const f = await razorpayFixture();
      await db.razorpayDeploymentOrder.updateMany({ where: { deploymentPaymentId: f.payment.id }, data: { status: 'SUPERSEDED' } });
      const create = f.gateway.createOrder.getMockImplementation()!;
      f.gateway.createOrder.mockImplementationOnce(async (...args) => { await create(...args); throw new RazorpayProviderError(); });
      await expect(f.service.createOrder(f.client.id, f.user.id, f.allocation.id)).rejects.toThrow('temporarily unavailable');
      await db.razorpayDeploymentOrder.updateMany({ where: { deploymentPaymentId: f.payment.id, status: 'CREATING' }, data: { createdAt: new Date(Date.now() - 60000) } });
      await expect(f.service.createOrder(f.client.id, f.user.id, f.allocation.id)).resolves.toMatchObject({ amount: f.order.amount });
      expect(f.gateway.createOrder).toHaveBeenCalledTimes(2);
      expect(f.gateway.findOrders).toHaveBeenCalledTimes(1);
    }, 30000);
    it('Razorpay retries a definitively rejected order without treating it as an ambiguous create', async () => {
      const f = await razorpayFixture();
      await db.razorpayDeploymentOrder.updateMany({ where: { deploymentPaymentId: f.payment.id }, data: { status: 'SUPERSEDED' } });
      f.gateway.createOrder.mockRejectedValueOnce(new RazorpayProviderError(true));
      await expect(f.service.createOrder(f.client.id, f.user.id, f.allocation.id)).rejects.toThrow('temporarily unavailable');
      await expect(f.service.createOrder(f.client.id, f.user.id, f.allocation.id)).resolves.toMatchObject({ amount: f.order.amount });
      expect(f.gateway.createOrder).toHaveBeenCalledTimes(3);
    }, 30000);
    it('Razorpay does not refund twice after an ambiguous refund HTTP response', async () => {
      const f = await razorpayFixture();
      await db.allocation.update({ where: { id: f.allocation.id }, data: { status: 'CANCELLED' } });
      f.remotes.push(f.remote);
      await f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input);
      const capture = await db.razorpayDeploymentCapture.findUniqueOrThrow({ where: { providerPaymentId: f.remote.id } });
      const refund = { id: `rfnd_${randomUUID().replaceAll('-', '')}`, payment_id: f.remote.id, amount: f.remote.amount, receipt: capture.id, status: 'processed' };
      f.gateway.refund.mockRejectedValueOnce(new RazorpayProviderError());
      await expect(f.service.reconcileAllocation(f.client.id, f.allocation.id)).rejects.toThrow('temporarily unavailable');
      f.gateway.findRefunds.mockResolvedValueOnce([refund]);
      await f.service.reconcileAllocation(f.client.id, f.allocation.id);
      expect(f.gateway.refund).toHaveBeenCalledTimes(1);
      expect(await db.razorpayDeploymentCapture.findUnique({ where: { id: capture.id } })).toMatchObject({ status: 'REFUNDED', providerRefundId: refund.id });
    }, 30000);
    it('Razorpay durably deduplicates webhook events and rejects event ID content changes', async () => {
      const f = await razorpayFixture();
      const eventId = randomUUID();
      const raw = Buffer.from(JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: f.remote.id, order_id: f.order.orderId } } } }));
      await Promise.all([f.service.webhook(raw, 'signature', eventId), f.service.webhook(raw, 'signature', eventId)]);
      expect(await db.paymentProviderEvent.count({ where: { provider: 'RAZORPAY', eventKey: eventId } })).toBe(1);
      await expect(f.service.webhook(Buffer.from(JSON.stringify({ event: 'payment.failed', payload: {} })), 'signature', eventId)).rejects.toThrow('different content');
    }, 30000);

    it('Razorpay retries a durably stored failed webhook without any app callback', async () => {
      const f = await razorpayFixture();
      f.remotes.push(f.remote);
      const eventId = randomUUID();
      await f.service.webhook(Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: f.remote.id, order_id: f.order.orderId } } } })), 'signature', eventId);
      f.gateway.fetchPayment.mockRejectedValueOnce(new RazorpayProviderError());
      await expect(f.service.reconcileAllocation(f.client.id, f.allocation.id)).rejects.toThrow('temporarily unavailable');
      expect(await db.paymentProviderEvent.findUnique({ where: { provider_eventKey: { provider: 'RAZORPAY', eventKey: eventId } } })).toMatchObject({ status: 'FAILED' });
      await f.service.reconcileAllocation(f.client.id, f.allocation.id);
      expect(await db.paymentProviderEvent.findUnique({ where: { provider_eventKey: { provider: 'RAZORPAY', eventKey: eventId } } })).toMatchObject({ status: 'PROCESSED' });
      expect(await db.deploymentPayment.findUnique({ where: { id: f.payment.id } })).toMatchObject({ status: 'PAID' });
      const raw = Buffer.from(JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: f.remote.id, order_id: f.order.orderId } } } }));
      await f.service.webhook(raw, 'signature', randomUUID());
      await f.service.reconcileAllocation(f.client.id, f.allocation.id);
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(1);
    }, 30000);
    it('Razorpay flags cancellation after accounting for reversal instead of refunding spendable deposits', async () => {
      const f = await razorpayFixture();
      f.remotes.push(f.remote);
      await f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input);
      await db.allocation.update({ where: { id: f.allocation.id }, data: { status: 'CANCELLED' } });
      await f.service.reconcileAllocation(f.client.id, f.allocation.id);
      expect(await db.razorpayDeploymentCapture.findUnique({ where: { providerPaymentId: f.remote.id } })).toMatchObject({ status: 'REVIEW_REQUIRED', reason: 'SETTLED_CANCELLATION_REQUIRES_REVERSAL' });
      expect(f.gateway.refund).not.toHaveBeenCalled();
    }, 30000);

    it('Razorpay does not refund the same gateway payment already approved manually by staff', async () => {
      const f = await razorpayFixture();
      await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'Razorpay', f.remote.id);
      await mobile.verifyPayment(f.client.id, f.manager.id, f.allocation.id);
      f.remotes.push(f.remote);
      expect(await f.service.verify(f.client.id, f.user.id, f.allocation.id, f.input)).toMatchObject({ status: 'PAID', provider: 'RAZORPAY' });
      expect(await db.razorpayDeploymentCapture.findUnique({ where: { providerPaymentId: f.remote.id } })).toMatchObject({ status: 'SETTLED' });
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(1);
      expect(f.gateway.refund).not.toHaveBeenCalled();
    }, 30000);

    it('routes common DEPLOYMENT checkout to existing deposit and commercial settlement exactly once', async () => {
      const f = await razorpayFixture();
      const api = new CommonPaymentService(db as never, new RiderBillingService(db as never), {} as never, f.service, {} as never);
      const created = await api.create(f.client.id, f.user.id, { purpose: 'DEPLOYMENT', allocationId: f.allocation.id });
      expect(created).toMatchObject({ purpose: 'DEPLOYMENT', provider: 'RAZORPAY', status: 'PENDING', amount: '1350.00' });
      expect(f.gateway.createOrder).toHaveBeenCalledTimes(1);
      f.remotes.push(f.remote);
      await api.verify(f.client.id, f.user.id, created.paymentRequestId!, f.input);
      expect(await api.verify(f.client.id, f.user.id, created.paymentRequestId!, f.input)).toMatchObject({ status: 'SUCCEEDED', checkout: null });
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(1);
      expect(await db.mobileDeploymentWorkflow.findUnique({ where: { allocationId: f.allocation.id } })).toMatchObject({ status: 'PAYMENT_PAID' });
      expect(await db.riderDeposit.findFirst({ where: { clientId: f.client.id, fundedAmount: { gt: 0 } } })).not.toBeNull();
    }, 30000);
    it('common deposit checkout reuses the same key and blocks new-key duplicates against real pending collections', async () => {
      const f = await fixture(); await f.select();
      const deposit = await db.riderDeposit.findFirstOrThrow({ where: { clientId: f.client.id, requiredAmount: { gt: 0 } } });
      const provider = { createCheckoutOrder: vi.fn(async (input: { orderId: string }) => ({ orderId: input.orderId, paymentSessionId: 'test-session', rawStatus: 'ACTIVE' })) };
      const checkout = new CheckoutCollectionService(db as never, { getOrThrow: () => 'mock', get: () => undefined } as never, provider as never, {} as never, {} as never, {} as never, {} as never, {} as never);
      const api = new CommonPaymentService(db as never, new RiderBillingService(db as never), checkout, {} as never, {} as never);
      const key = randomUUID();
      const request = await api.create(f.client.id, f.user.id, { purpose: 'SECURITY_DEPOSIT', depositId: deposit.id }, key);
      expect(await api.create(f.client.id, f.user.id, { purpose: 'SECURITY_DEPOSIT', depositId: deposit.id }, key)).toEqual(request);
      const duplicates = await Promise.allSettled([randomUUID(), randomUUID()].map(k => api.create(f.client.id, f.user.id, { purpose: 'SECURITY_DEPOSIT', depositId: deposit.id }, k)));
      expect(duplicates.every(result => result.status === 'rejected')).toBe(true);
      expect(await db.paymentCollectionRequest.count({ where: { clientId: f.client.id, depositId: deposit.id } })).toBe(1);
      expect(provider.createCheckoutOrder).toHaveBeenCalledTimes(1);
    }, 30000);

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

    it('scopes Fleet Manager exchange access by actual/planned hubs and protects foreign replacements', async () => {
      const f = await fixture(); const { agreement } = await f.select();
      const otherHub = await db.hub.create({ data: { clientId: f.client.id, code: 'OTHER', name: 'Other hub', city: 'Gurugram' } });
      const exchange = await db.vehicleExchangeRequest.create({ data: { clientId: f.client.id, agreementId: agreement.id, riderId: f.rider.id, oldVehicleId: f.fleet.id, oldAllocationId: f.allocation.id, plannedHubId: f.hub.id, baseVersionNumber: 1, reasonCode: 'VEHICLE_EXCHANGE', createdById: f.user.id } });
      const guard = new ExchangeHubGuard(db as never, new ClientContextService());
      const service = new VehicleExchangeService(db as never, pricing, deposits, allocations);
      const controller = new VehicleExchangeController(service, new ClientContextService());
      async function scoped(actor: AuthUser = f.actor, id?: string, method = 'GET') {
        const request: ExchangeHubRequest = { user: actor, method, params: id ? { id } : {} };
        await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext);
        return request;
      }
      expect((await controller.list(f.actor, await scoped())).map(row => row.id)).toContain(exchange.id);
      await scoped(f.actor, exchange.id, 'POST'); await controller.approve(f.actor, exchange.id);
      expect(await db.auditLog.findFirst({ where: { clientId: f.client.id, actorId: f.manager.id, action: 'VEHICLE_EXCHANGE_APPROVED', entityId: exchange.id } })).not.toBeNull();
      // A foreign planned hub must not fall back to the old scooter's local hub.
      await db.vehicleExchangeRequest.update({ where: { id: exchange.id }, data: { plannedHubId: otherHub.id } });
      expect(await controller.list(f.actor, await scoped())).toEqual([]);
      await expect(scoped(f.actor, exchange.id)).rejects.toThrow('assigned hubs');
      await db.vehicleExchangeRequest.update({ where: { id: exchange.id }, data: { plannedHubId: null } });
      expect((await controller.list(f.actor, await scoped())).map(row => row.id)).toContain(exchange.id);
      // Once intake exists, its actual hub is authoritative over both fallbacks.
      const inspection = await db.inspection.create({ data: { clientId: f.client.id, allocationId: f.allocation.id, type: 'POST_DEALLOCATION' } });
      const submission = await db.vehicleSubmission.create({ data: { clientId: f.client.id, allocationId: f.allocation.id, inspectionId: inspection.id, exchangeRequestId: exchange.id, riderId: f.rider.id, fleetId: f.fleet.id, agreementId: agreement.id, hubId: otherHub.id, assetSnapshot: {}, requiredPhotoTypes: [], createdById: f.manager.id } });
      await db.vehicleExchangeRequest.update({ where: { id: exchange.id }, data: { plannedHubId: f.hub.id } });
      expect(await controller.list(f.actor, await scoped())).toEqual([]);
      await db.vehicleSubmission.update({ where: { id: submission.id }, data: { hubId: f.hub.id } });
      await db.vehicleExchangeRequest.update({ where: { id: exchange.id }, data: { plannedHubId: otherHub.id } });
      expect((await controller.list(f.actor, await scoped())).map(row => row.id)).toContain(exchange.id);
      const replacement = await db.fleet.create({ data: { clientId: f.client.id, fleetCode: 'FOREIGN-REPLACEMENT', chassisNumber: randomUUID(), oemId: f.fleet.oemId, vehicleCategoryId: f.fleet.vehicleCategoryId, vehicleTypeId: f.fleet.vehicleTypeId, speedType: f.fleet.speedType, currentHubId: otherHub.id, status: 'AVAILABLE' } });
      await db.vehicleExchangeRequest.update({ where: { id: exchange.id }, data: { replacementVehicleId: replacement.id } });
      await expect(scoped(f.actor, exchange.id, 'POST')).rejects.toThrow('replacement scooter');
      // Existing administrative access remains client-wide.
      const admin = { ...f.actor, roles: [UserRole.CLIENT_ADMIN] };
      expect((await controller.list(admin, await scoped(admin))).map(row => row.id)).toContain(exchange.id);
      const unassigned = await db.user.create({ data: { clientId: f.client.id, name: 'Unassigned manager', mobile: randomUUID(), role: 'FLEET_MANAGER' } });
      expect(await controller.list({ ...f.actor, id: unassigned.id }, await scoped({ ...f.actor, id: unassigned.id }))).toEqual([]);
      const foreign = await fixture(); await expect(scoped(foreign.actor, exchange.id)).rejects.toThrow('assigned hubs');
    }, 30000);

    it('uploads immutable receipt evidence, rejects with history, resubmits and credits once across admin and fleet-manager approval', async () => {
      const f = await fixture();
      await f.select();
      await mobile.requestFleet(f.client.id, f.manager.id, f.allocation.id);
      const payment = await mobile.askPayment(f.client.id, f.manager.id, f.allocation.id);
      const adminUser = await db.user.create({ data: { clientId: f.client.id, name: 'Admin', mobile: '9876543299', role: 'CLIENT_ADMIN' } });
      const admin = { id: adminUser.id, clientId: f.client.id, roles: [UserRole.CLIENT_ADMIN] };
      const sealed: string[] = [];
      const media = new MediaService(db as never, { createUploadUrl: async () => 'https://upload.invalid', createDownloadUrl: async (key: string) => `https://view.invalid/${key}`,
        assertObjectExists: async () => {}, sealObject: async (_source: string, destination: string) => { sealed.push(destination); } } as never);
      const transactions = new PaymentTransactionsService(db as never, media, commercial);
      await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'UPI', 'FIRST-' + payment.id);
      const first = await transactions.detail(f.client.id, admin, 'DEPLOYMENT', payment.id);
      expect(first).toMatchObject({ status: 'SUBMITTED', submissionVersion: 1, canReview: true });
      const upload = await transactions.upload(f.client.id, f.riderActor, 'DEPLOYMENT', payment.id, { fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 100 });
      const uploaded = await transactions.complete(f.client.id, f.riderActor, 'DEPLOYMENT', payment.id, upload.photo.id);
      await transactions.complete(f.client.id, f.riderActor, 'DEPLOYMENT', payment.id, upload.photo.id);
      expect(uploaded.status).toBe('COMPLETE'); expect(sealed).toHaveLength(1);
      expect(await db.auditLog.count({ where: { clientId: f.client.id, entityType: 'Photo', entityId: upload.photo.id, action: 'PAYMENT_RECEIPT_UPLOADED' } })).toBe(1);
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(0);
      await expect(transactions.reject(f.client.id, admin, 'DEPLOYMENT', payment.id, 1, '   ')).rejects.toThrow('rejection reason');
      await expect(transactions.approve(f.client.id, admin, 'DEPLOYMENT', payment.id, 1)).rejects.toThrow('submission changed');
      const afterUpload = await transactions.detail(f.client.id, admin, 'DEPLOYMENT', payment.id);
      expect(afterUpload.submissionVersion).toBe(2);
      const rejected = await transactions.reject(f.client.id, admin, 'DEPLOYMENT', payment.id, 2, 'Reference does not match received funds');
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'Reference does not match received funds' });
      expect(rejected.history.some(x => x.action === 'PAYMENT_REJECTED' && (x.newData as { providerReference?: string }).providerReference === 'FIRST-' + payment.id)).toBe(true);
      expect((await db.mobileDeploymentWorkflow.findUniqueOrThrow({ where: { allocationId: f.allocation.id } })).status).toBe('PAYMENT_PENDING');
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(0);
      await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'UPI', 'CORRECTED-' + payment.id);
      await expect(transactions.approve(f.client.id, admin, 'DEPLOYMENT', payment.id, 1)).rejects.toThrow('submission changed');
      await expect(transactions.reject(f.client.id, admin, 'DEPLOYMENT', payment.id, 1, 'Stale review')).rejects.toThrow('submission changed');
      await Promise.all([transactions.approve(f.client.id, admin, 'DEPLOYMENT', payment.id, 3), mobile.verifyPayment(f.client.id, f.manager.id, f.allocation.id)]);
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(1);
      const approved = await transactions.detail(f.client.id, admin, 'DEPLOYMENT', payment.id);
      expect(approved.status).toBe('PAID'); expect(approved.receipts.map(x => x.id)).toContain(upload.photo.id);
      expect(approved.history.filter(x => x.action === 'PAYMENT_APPROVED')).toHaveLength(1);
      await expect(transactions.reject(f.client.id, admin, 'DEPLOYMENT', payment.id, 3, 'Cannot reject paid')).rejects.toThrow('Only a submitted payment');
      const q = { page: 1, limit: 10, sortBy: 'amount', sortDirection: 'desc' };
      expect((await transactions.list(f.client.id, admin, q)).items).toHaveLength(1);
      expect((await transactions.list(f.client.id, admin, { ...q, search: 'CORRECTED-' })).items[0].receiptCount).toBe(1);
      const outsider = await db.user.create({ data: { clientId: f.client.id, name: 'Other rider', mobile: '9876543288', role: 'RIDER' } });
      await db.rider.create({ data: { clientId: f.client.id, userId: outsider.id, name: 'Other rider', mobile: outsider.mobile } });
      await expect(transactions.detail(f.client.id, { id: outsider.id, clientId: f.client.id, roles: [UserRole.RIDER] }, 'DEPLOYMENT', payment.id)).rejects.toThrow('not found');
      await expect(transactions.detail('foreign-client', admin, 'DEPLOYMENT', payment.id)).rejects.toThrow('not found');
      await expect(transactions.approve(f.client.id, f.riderActor, 'DEPLOYMENT', payment.id, 2)).rejects.toThrow();
      await expect(media.complete(f.client.id, upload.photo.id)).rejects.toThrow('payment transaction routes');
      await expect(media.downloadUrl(f.client.id, upload.photo.id)).rejects.toThrow('payment transaction routes');
      await expect(media.listEntityPhotos(f.client.id, 'PAYMENT' as never, 'OTHER', payment.id)).rejects.toThrow('payment transaction routes');
      expect((await transactions.download(f.client.id, f.actor, 'DEPLOYMENT', payment.id, upload.photo.id)).url).toContain('payment-receipts');
      const otherManager = await db.user.create({ data: { clientId: f.client.id, name: 'Other manager', mobile: '9876543277', role: 'FLEET_MANAGER' } });
      await expect(transactions.detail(f.client.id, { id: otherManager.id, clientId: f.client.id, roles: [UserRole.FLEET_MANAGER] }, 'DEPLOYMENT', payment.id)).rejects.toThrow('assigned hub');
    });

    it('resumes UPI submission, checks receipt ownership and handles lost responses after approval', async () => {
      const f = await fixture(); await f.select();
      await mobile.requestFleet(f.client.id, f.manager.id, f.allocation.id);
      const p = await mobile.askPayment(f.client.id, f.manager.id, f.allocation.id);
      expect(await mobile.payment(f.client.id, f.user.id, f.allocation.id)).toMatchObject({ source: 'DEPLOYMENT', canSubmit: true, receiptOptional: true, nextAction: 'SUBMIT_PAYMENT_DETAILS' });
      await expect(mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'UPI', 'INVALID-' + p.id, [randomUUID()])).rejects.toThrow('completed upload');
      expect((await db.deploymentPayment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PENDING');
      const media = new MediaService(db as never, { createUploadUrl: async () => 'https://upload.invalid', createDownloadUrl: async () => 'https://view.invalid', assertObjectExists: async () => {}, sealObject: async () => {} } as never);
      const transactions = new PaymentTransactionsService(db as never, media, commercial);
      const upload = await transactions.upload(f.client.id, f.riderActor, 'DEPLOYMENT', p.id, { fileName: 'upi.jpg', mimeType: 'image/jpeg', sizeBytes: 100 });
      await expect(mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'UPI', 'UPI-' + p.id, [upload.photo.id])).rejects.toThrow('completed upload');
      await transactions.complete(f.client.id, f.riderActor, 'DEPLOYMENT', p.id, upload.photo.id);
      const submitted = await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, ' UPI ', ' UPI-' + p.id + ' ', [upload.photo.id]);
      expect(submitted).toMatchObject({ status: 'SUBMITTED', submissionVersion: 1, nextAction: 'AWAITING_VERIFICATION', canSubmit: false });
      expect(submitted.receipts.map(photo => photo.id)).toContain(upload.photo.id);
      expect((await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'UPI', 'UPI-' + p.id, [upload.photo.id])).submissionVersion).toBe(1);
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(0);
      await mobile.verifyPayment(f.client.id, f.manager.id, f.allocation.id);
      const retry = await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'UPI', 'UPI-' + p.id, [upload.photo.id]);
      expect(retry).toMatchObject({ status: 'PAID', nextAction: 'PAYMENT_COMPLETE', canSubmit: false });
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(1);
      const other = await fixture(); await other.select();
      await mobile.requestFleet(other.client.id, other.manager.id, other.allocation.id);
      await mobile.askPayment(other.client.id, other.manager.id, other.allocation.id);
      await expect(mobile.submitPaymentReference(other.client.id, other.user.id, other.allocation.id, 'UPI', 'UPI-' + p.id, [upload.photo.id])).rejects.toThrow();
    });

    it('serializes simultaneous admin approval and Fleet Manager rejection without a contradictory financial result', async () => {
      const f = await fixture(); await f.select();
      await mobile.requestFleet(f.client.id, f.manager.id, f.allocation.id);
      const p = await mobile.askPayment(f.client.id, f.manager.id, f.allocation.id);
      await mobile.submitPaymentReference(f.client.id, f.user.id, f.allocation.id, 'UPI', 'RACE-' + p.id);
      const admin = await db.user.create({ data: { clientId: f.client.id, name: 'Admin', mobile: '9876543266', role: 'CLIENT_ADMIN' } });
      const results = await Promise.allSettled([
        commercial.verifyPayment(f.client.id, admin.id, f.allocation.id, 1),
        mobile.rejectPayment(f.client.id, f.manager.id, f.allocation.id, 'Funds not received', 1),
      ]);
      expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      const final = await db.deploymentPayment.findUniqueOrThrow({ where: { id: p.id } });
      expect(['PAID', 'REJECTED']).toContain(final.status);
      expect(await db.riderPayment.count({ where: { clientId: f.client.id } })).toBe(final.status === 'PAID' ? 1 : 0);
      expect((await db.mobileDeploymentWorkflow.findUniqueOrThrow({ where: { allocationId: f.allocation.id } })).status)
        .toBe(final.status === 'PAID' ? 'PAYMENT_PAID' : 'PAYMENT_PENDING');
    });

    it('shows provider and standalone payments once and scopes listing, filters, and receipt access to the owning rider', async () => {
      const f = await fixture();
      const received = await db.riderPayment.create({ data: { clientId: f.client.id, riderId: f.rider.id, amount: '100', unallocatedAmount: '100', currency: 'INR', method: 'UPI', idempotencyKey: 'collection-receipt', receivedAt: new Date(), createdById: f.manager.id } });
      const collection = await db.paymentCollectionRequest.create({ data: { clientId: f.client.id, riderId: f.rider.id, amount: '100', currency: 'INR', collectionType: 'INVOICE', method: 'UPI', provider: 'CASHFREE', status: 'PAID', idempotencyKey: 'collection', riderPaymentId: received.id } });
      const standalone = await db.riderPayment.create({ data: { clientId: f.client.id, riderId: f.rider.id, amount: '25', unallocatedAmount: '25', currency: 'INR', method: 'CASH', idempotencyKey: 'cash', receivedAt: new Date(), createdById: f.manager.id } });
      const media = new MediaService(db as never, {} as never);
      const service = new PaymentTransactionsService(db as never, media, commercial);
      const q = { page: 1, limit: 1, sortBy: 'amount', sortDirection: 'desc' };
      const page1 = await service.list(f.client.id, f.riderActor, q);
      expect(page1.total).toBe(2); expect(page1.items[0]).toMatchObject({ source: 'COLLECTION', id: collection.id, canReview: false });
      expect((await service.list(f.client.id, f.riderActor, { ...q, page: 2 })).items[0].id).toBe(standalone.id);
      expect((await service.list(f.client.id, f.riderActor, { ...q, source: 'RECEIVED' })).total).toBe(1);
      expect((await service.list(f.client.id, f.riderActor, { ...q, status: 'REJECTED' })).total).toBe(0);
      const admin = { ...f.actor, roles: [UserRole.CLIENT_ADMIN] };
      await expect(service.approve(f.client.id, admin, 'COLLECTION', collection.id, 0)).rejects.toThrow('automatic verification');
      await expect(service.reject(f.client.id, admin, 'COLLECTION', collection.id, 0, 'Not applicable')).rejects.toThrow('manually submitted allocation');
      await expect(service.approve(f.client.id, admin, 'RECEIVED', standalone.id, 0)).rejects.toThrow('automatic verification');
      await expect(service.download(f.client.id, f.riderActor, 'COLLECTION', collection.id, randomUUID())).rejects.toThrow('Photo not found');
      await expect(service.detail(f.client.id, f.riderActor, '__proto__', collection.id)).rejects.toThrow('Invalid payment source');
    });

    it('activates a scooter without onboarding photos, lists it for allocation, and still requires fresh allocation inspection photos', async () => {
      const f = await fixture(true);
      expect(f.client.fleetOperatingMode).toBe('SIMPLE');
      const fleets = new FleetsService(db as never, new FleetStatusPolicy());
      const scooter = await fleets.create(f.client.id, {
        chassisNumber: randomUUID(), fleetCode: 'OPTIONAL-PHOTOS', oemId: f.fleet.oemId,
        vehicleCategoryId: f.fleet.vehicleCategoryId, vehicleTypeId: f.fleet.vehicleTypeId,
        speedType: 'SLOW_SPEED', ownershipType: 'CLIENT_OWNED', currentHubId: f.hub.id,
      });
      expect((await mobile.eligibleFleets(f.client.id, f.manager.id)).map(row => row.id)).not.toContain(scooter.id);
      expect(await fleets.onboardingStatus(f.client.id, scooter.id)).toMatchObject({ ready: true, evidenceComplete: true, photosRequired: false });
      await fleets.activate(f.client.id, scooter.id, f.manager.id);
      expect((await mobile.eligibleFleets(f.client.id, f.manager.id)).map(row => row.id)).toContain(scooter.id);
      expect(await db.photo.count({ where: { clientId: f.client.id, workFlowType: 'FLEET_INSPECTION', subjectType: 'FLEET' } })).toBe(0);
      await f.select();
      await f.pay(); // requestFleet must accept absent onboarding photos too.
      await db.photoRequirement.create({ data: { clientId: f.client.id, workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', photoType: 'FRONT', isRequired: true } });
      await expect(f.handover()).rejects.toThrow('Allocation evidence is incomplete.');
      const inspection = await db.inspection.findUniqueOrThrow({ where: { allocationId_type: { allocationId: f.allocation.id, type: 'PRE_ALLOCATION' } } });
      await db.photo.create({ data: { clientId: f.client.id, workFlowType: 'FLEET_ALLOTMENT', subjectType: 'FLEET', entityId: inspection.id, photoType: 'FRONT', objectKey: randomUUID(), mimeType: 'image/jpeg', sizeBytes: 100, status: 'COMPLETE', uploadedById: f.manager.id } });
      await f.handover();
      expect((await db.allocation.findUniqueOrThrow({ where: { id: f.allocation.id } })).status).toBe('ACTIVE');
    });

    it('blocks new handover for unpaid penalties and consumes a reasoned admin exception only for its approved debt', async () => {
      const f = await fixture(true);
      await f.select();
      await f.pay();
      const billing = new RiderBillingService(db as never);
      const charge = (key: string) => db.$transaction((tx) => billing.issueChargeInTransaction(tx, f.client.id, f.rider.id, f.manager.id, `return-penalty:${key}`, { chargeType: 'RETURN_PENALTY', description: 'Previous return penalty', quantity: '1', unitAmount: '100.00', currency: 'INR' }));
      await charge('old-penalty');
      await expect(f.handover()).rejects.toMatchObject({ response: { code: 'UNPAID_SUBMISSION_PENALTIES' } });
      const admin = await db.user.create({ data: { clientId: f.client.id, name: 'Admin', mobile: '9876543214', role: 'CLIENT_ADMIN' } });
      const actor = { id: admin.id, clientId: f.client.id, roles: [UserRole.CLIENT_ADMIN] };
      const penalties = new SubmissionPenaltyService(db as never);
      await expect(penalties.approve(f.client.id, f.actor, f.allocation.id, 'Allow return to work')).rejects.toThrow('Only a Client Admin');
      await expect(penalties.approve(f.client.id, actor, f.allocation.id, '   ')).rejects.toThrow('nonblank');
      const approval = await penalties.approve(f.client.id, actor, f.allocation.id, 'Payment arrangement approved');
      expect((await penalties.clearance(f.client.id, f.actor, f.allocation.id)).handoverBlocked).toBe(false);
      await charge('new-penalty');
      await expect(allocations.activate(f.client.id, f.allocation.id)).rejects.toMatchObject({ response: { code: 'UNPAID_SUBMISSION_PENALTIES' } });
      expect((await db.penaltyHandoverException.findUniqueOrThrow({ where: { id: approval.id } })).usedAt).toBeNull();
      const updated = await penalties.approve(f.client.id, actor, f.allocation.id, 'Updated payment arrangement approved');
      await allocations.activate(f.client.id, f.allocation.id);
      expect((await db.penaltyHandoverException.findUniqueOrThrow({ where: { id: updated.id } })).usedAt).not.toBeNull();
      expect((await db.allocation.findUniqueOrThrow({ where: { id: f.allocation.id } })).status).toBe('ACTIVE');
      expect((await penalties.clearance(f.client.id, f.actor, f.allocation.id)).hasUnpaidPenalties).toBe(true);
    });

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
