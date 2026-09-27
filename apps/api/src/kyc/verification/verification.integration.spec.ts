import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProviderRegistryService } from './provider-registry.service.js';
import { SandboxVerificationProvider } from './sandbox-verification.provider.js';
import { VerificationService } from './verification.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { KycRoutingEngine } from '../routing/kyc-routing.engine.js';
import { KycResultArbitrator } from '../routing/kyc-result-arbitrator.js';
import { KycProviderHealthService } from '../routing/kyc-provider-health.service.js';
import { KycProviderCode } from '@prisma/client';
import { SandboxHttpError } from './sandbox-http.service.js';
import type { VerificationProvider } from './kyc-types.js';
import { KycCommercialService } from '../commercial/kyc-commercial.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('KYC PostgreSQL integration', () => {
  let prisma: PrismaService;
  let service: VerificationService;
  let clientA: string;
  let clientB: string;
  let riderA: string;
  let riderB: string;
  let credentialId: string;
  let packageId: string;
  let subscriptionId: string;
  let featureId: string;
  let testFeaturePricingId: string | null = null;
  let testAddOnId: string | null = null;
  let testAdjustmentId: string | null = null;
  let createdFeature = false;
  let registry: ProviderRegistryService;
  let routing: KycRoutingEngine;
  let testProviderId: string | null = null;
  let testCredentialId: string | null = null;
  const marker = randomUUID();
  let providerCalls = 0;
  let retrySandboxFailure = true;
  let retryPanFailure = true;

  beforeAll(async () => {
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl! } } });
    const [a, b] = await Promise.all([
      prisma.client.create({ data: { name: 'KYC Test A', slug: `kyc-test-a-${marker}` } }),
      prisma.client.create({ data: { name: 'KYC Test B', slug: `kyc-test-b-${marker}` } }),
    ]);
    clientA = a.id; clientB = b.id;
    const [ra, rb] = await Promise.all([
      prisma.rider.create({ data: { clientId: clientA, name: 'Test Rider A', mobile: '9000000001' } }),
      prisma.rider.create({ data: { clientId: clientB, name: 'Test Rider B', mobile: '9000000002' } }),
    ]);
    riderA = ra.id; riderB = rb.id;
    const provider = await prisma.kycProviderConfig.upsert({ where: { code: 'SANDBOX' },
      create: { code: 'SANDBOX', name: 'Sandbox', isActive: true }, update: { isActive: true } });
    await prisma.kycProviderCapability.upsert({ where: { providerId_verificationType: {
      providerId: provider.id, verificationType: 'IFSC_VERIFICATION' } },
      create: { providerId: provider.id, verificationType: 'IFSC_VERIFICATION', isSupported: true, isEnabled: true },
      update: { isSupported: true, isEnabled: true } });
    await prisma.kycProviderCapability.upsert({ where: { providerId_verificationType: {
      providerId: provider.id, verificationType: 'PAN_VERIFICATION' } },
      create: { providerId: provider.id, verificationType: 'PAN_VERIFICATION', isSupported: true, isEnabled: true },
      update: { isSupported: true, isEnabled: true } });
    const pkg = await prisma.package.create({ data: { code: `KYC_TEST_${marker}`, name: 'KYC test package' } });
    packageId = pkg.id;
    const existingFeature = await prisma.feature.findUnique({ where: { code: 'PAN_VERIFICATION' } });
    const feature = existingFeature
      ?? await prisma.feature.create({ data: { code: 'PAN_VERIFICATION', name: 'PAN Verification',
        featureType: 'USAGE_BASED', billingUnit: 'VERIFICATION' } });
    createdFeature = !existingFeature;
    featureId = feature.id;
    const subscription = await prisma.clientSubscription.create({ data: { clientId: clientA,
      packageId, billingCycle: 'MONTHLY', startDate: new Date('2026-01-01') } });
    subscriptionId = subscription.id;
    await prisma.clientFeature.create({ data: { clientId: clientA, subscriptionId, featureId,
      effectiveFrom: new Date('2026-01-01'), enabled: true, unlimitedUsage: true } });
    const credential = await prisma.kycProviderCredential.create({ data: { providerId: provider.id,
      environment: 'TEST', secretReference: 'env:KYC_SANDBOX_TEST' } });
    credentialId = credential.id;
    const sandbox = new SandboxVerificationProvider({ circuitOpen: () => false, request: async (path: string, _method: string, body?: { pan?: string }) => {
      providerCalls += 1;
      if (path === '/kyc/pan/verify' && body?.pan === 'ABCDE9999F' && retryPanFailure) {
        retryPanFailure = false;
        throw new SandboxHttpError('PROVIDER_TIMEOUT');
      }
      if (path === '/bank/HDFC0009999' || path === '/bank/HDFC0007777' && retrySandboxFailure) {
        if (path === '/bank/HDFC0007777') retrySandboxFailure = false;
        throw new SandboxHttpError('PROVIDER_TIMEOUT');
      }
      if (path === '/kyc/pan/verify') return { data: { status: 'valid',
        name_as_per_pan_match: true, date_of_birth_match: true } };
      return { IFSC: 'HDFC0001234', BANK: 'Test Bank', BRANCH: 'Test Branch' };
    } } as never);
    registry = new ProviderRegistryService(prisma, sandbox);
    routing = new KycRoutingEngine(prisma, registry, new KycResultArbitrator(), new AuditService(prisma),
      new KycProviderHealthService(prisma, registry, { isOpen: async () => false } as never));
    service = new VerificationService(prisma, registry,
      { get: (key: string) => key === 'KYC_ENABLED' ? true : 'a'.repeat(40) } as never, routing,
      new KycCommercialService(prisma));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.kycProviderConflict.deleteMany({ where: { verification: { clientId: { in: [clientA, clientB] } } } });
    await prisma.kycRoutingDecision.deleteMany({ where: { verification: { clientId: { in: [clientA, clientB] } } } });
    await prisma.kycVerificationResult.deleteMany({ where: { verification: { clientId: { in: [clientA, clientB] } } } });
    await prisma.featureUsageConsumption.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await prisma.featureUsageLedger.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await prisma.featureCreditLot.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await prisma.clientFeatureAddOnPurchase.deleteMany({ where: { clientId: clientA } });
    await prisma.kycVerificationAttempt.deleteMany({ where: { verification: { clientId: { in: [clientA, clientB] } } } });
    await prisma.kycRecoveryRequest.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await prisma.kycVerification.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await prisma.kycRoutingProvider.deleteMany({ where: { routingPolicy: { clientId: clientA } } });
    await prisma.kycRoutingPolicy.deleteMany({ where: { clientId: clientA } });
    await prisma.kycClientPolicy.deleteMany({ where: { clientId: clientA } });
    await prisma.kycConsent.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await prisma.auditLog.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await prisma.kycProviderCredential.delete({ where: { id: credentialId } });
    if (testCredentialId) await prisma.kycProviderCredential.delete({ where: { id: testCredentialId } });
    if (testProviderId) {
      await prisma.kycProviderCapability.deleteMany({ where: { providerId: testProviderId } });
      await prisma.kycProviderConfig.delete({ where: { id: testProviderId } });
    }
    await prisma.clientFeaturePricing.deleteMany({ where: { clientFeature: { clientId: clientA } } });
    if (testAdjustmentId) await prisma.clientPricingAdjustment.delete({ where: { id: testAdjustmentId } });
    await prisma.clientFeature.deleteMany({ where: { subscriptionId } });
    if (testAddOnId) await prisma.featureAddOn.delete({ where: { id: testAddOnId } });
    if (testFeaturePricingId) await prisma.featurePricing.delete({ where: { id: testFeaturePricingId } });
    await prisma.clientSubscription.delete({ where: { id: subscriptionId } });
    await prisma.package.delete({ where: { id: packageId } });
    if (createdFeature) await prisma.feature.delete({ where: { id: featureId } });
    await prisma.rider.deleteMany({ where: { id: { in: [riderA, riderB] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await prisma.$disconnect();
  });

  it('persists one business verification and one attempt across idempotent retries', async () => {
    const key = `kyc-integration-${marker}`;
    const input = { riderId: riderA, type: 'IFSC_VERIFICATION' as const, ifsc: 'HDFC0001234' };
    const first = await service.start(clientA, key, input);
    const second = await service.start(clientA, key, input);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe('VERIFIED');
    expect(first.attempts).toHaveLength(1);
    expect(first.results).toHaveLength(1);
    expect(providerCalls).toBe(1);
    await expect(service.get(clientB, first.id)).rejects.toThrow('KYC_VERIFICATION_NOT_FOUND');
    await expect(service.start(clientA, key, { ...input, ifsc: 'ICIC0001234' })).rejects.toThrow('different verification');
  });

  it('synchronizes verified PAN to the existing Rider KYC onboarding record', async () => {
    const consent = await service.consent(clientA, { riderId: riderA,
      verificationType: 'PAN_VERIFICATION', consentVersion: 'v1', consentTextHash: 'a'.repeat(64),
      purpose: 'Identity verification for rider onboarding', reason: 'Verify PAN for rider onboarding eligibility',
      accepted: true, channel: 'OPERATIONS_PANEL' });
    const record = await service.start(clientA, `kyc-pan-${marker}`, { riderId: riderA,
      type: 'PAN_VERIFICATION', pan: 'ABCDE1234F', name: 'Test Rider A',
      dateOfBirth: '01/01/2000', consentId: consent.id });
    expect(record.status).toBe('VERIFIED');
    expect(record.results[0]?.normalizedData).toMatchObject({ maskedPan: 'ABC****34F' });
    const onboarding = await prisma.riderKyc.findUnique({ where: { riderId_type: { riderId: riderA, type: 'PAN' } } });
    expect(onboarding).toMatchObject({ clientId: clientA, status: 'VERIFIED', provider: 'SANDBOX' });
  });

  it('persists fallback attempts under one verification using a test-only second provider', async () => {
    const mockProvider: VerificationProvider = {
      code: KycProviderCode.CASHFREE,
      supports: (type) => type === 'IFSC_VERIFICATION',
      verify: async (input) => input.ifsc === 'HDFC0008888'
        ? { status: 'FAILED', data: { ifsc: null }, failureType: 'BUSINESS_FAILURE', failureCategory: 'IDENTITY_MISMATCH' }
        : input.ifsc === 'HDFC0007777'
          ? { status: 'FAILED', data: { ifsc: null }, failureType: 'TECHNICAL_FAILURE', failureCategory: 'PROVIDER_ERROR' }
        : { status: 'VERIFIED', data: { ifsc: input.ifsc ?? null } },
      completeAadhaarOtp: async () => { throw new Error('Not supported by test provider'); },
      health: async () => 'AVAILABLE',
      circuitOpen: () => false,
    };
    registry.register(mockProvider);
    const config = await prisma.kycProviderConfig.create({ data: { code: 'CASHFREE', name: 'Test-only provider',
      isActive: true, environment: 'TEST', priority: 2 } });
    testProviderId = config.id;
    await prisma.kycProviderCapability.create({ data: { providerId: config.id, verificationType: 'IFSC_VERIFICATION',
      isSupported: true, isEnabled: true } });
    const credential = await prisma.kycProviderCredential.create({ data: { providerId: config.id,
      environment: 'TEST', secretReference: 'env:KYC_TEST_PROVIDER' } });
    testCredentialId = credential.id;
    const sandbox = await prisma.kycProviderConfig.findUniqueOrThrow({ where: { code: 'SANDBOX' } });
    const policy = await prisma.kycRoutingPolicy.create({ data: { clientId: clientA, code: 'IFSC_TEST_ROUTING',
      name: 'IFSC test fallback', verificationType: 'IFSC_VERIFICATION', strategy: 'FALLBACK', version: 1,
      isDefault: true, maxProvidersPerVerification: 2, maxAttempts: 2,
      providers: { create: [{ providerId: sandbox.id, priority: 1 }, { providerId: config.id, priority: 2 }] } } });
    const record = await service.start(clientA, `fallback-${marker}`, { riderId: riderA, type: 'IFSC_VERIFICATION', ifsc: 'HDFC0009999' });
    expect(record.status).toBe('VERIFIED');
    expect(record.attempts).toHaveLength(2);
    expect(record.attempts[0]).not.toHaveProperty('cost');
    expect(record.results).toHaveLength(2);
    expect(record.routingDecision?.routingPolicyVersion).toBe(1);
    expect(record.finalProvider?.code).toBe('CASHFREE');
    expect(policy.id).toBeTruthy();
  });

  it('retries only a technical failure with matching resubmitted input and one usage entry', async () => {
    const retryService = new VerificationService(prisma, registry, { get: (key: string) =>
      key === 'KYC_ENABLED' ? true : key === 'KYC_OPS_MAX_TECHNICAL_RETRIES' ? 1 : 'a'.repeat(40) } as never,
    routing, new KycCommercialService(prisma));
    const input = { riderId: riderA, type: 'IFSC_VERIFICATION' as const, ifsc: 'HDFC0007777' };
    const record = await retryService.start(clientA, `technical-${marker}`, input);
    expect(record.status).toBe('FAILED');
    expect(record.attempts).toHaveLength(2);
    expect((await retryService.retryPreview(clientA, record.id)).allowed).toBe(true);
    const usageBefore = await prisma.featureUsageConsumption.count({ where: { verificationId: record.id } });
    await expect(retryService.retry(clientA, record.id, `wrong-${marker}`,
      { ...input, ifsc: 'HDFC0001234' }, 0)).rejects.toThrow('KYC_RECOVERY_INPUT_MISMATCH');
    const callsBefore = providerCalls;
    const concurrent = await Promise.all([
      retryService.retry(clientA, record.id, `retry-${marker}`, input, 0),
      retryService.retry(clientA, record.id, `retry-${marker}`, input, 0),
    ]);
    expect(concurrent.filter((item) => !item.replayed)).toHaveLength(1);
    const after = await retryService.get(clientA, record.id);
    expect(after.status).toBe('VERIFIED');
    expect(after.attempts).toHaveLength(3);
    expect(after.attempts[2]?.reason).toBe('RETRY');
    expect(providerCalls - callsBefore).toBe(1);
    const replay = await retryService.retry(clientA, record.id, `retry-${marker}`, input, 0);
    expect(replay.replayed).toBe(true);
    expect(providerCalls - callsBefore).toBe(1);
    expect(await prisma.featureUsageConsumption.count({ where: { verificationId: record.id } })).toBe(usageBefore);
    expect((await retryService.retryPreview(clientA, record.id)).allowed).toBe(false);
  });

  it('retains the original PAN consumption when a technical retry succeeds', async () => {
    const retryService = new VerificationService(prisma, registry, { get: (key: string) =>
      key === 'KYC_ENABLED' ? true : key === 'KYC_OPS_MAX_TECHNICAL_RETRIES' ? 1 : 'a'.repeat(40) } as never,
    routing, new KycCommercialService(prisma));
    const consent = await retryService.consent(clientA, { riderId: riderA,
      verificationType: 'PAN_VERIFICATION', consentVersion: 'v1', consentTextHash: 'e'.repeat(64),
      purpose: 'Rider identity verification for onboarding', reason: 'Verify PAN for rider eligibility',
      accepted: true, channel: 'OPERATIONS_PANEL' });
    const input = { riderId: riderA, type: 'PAN_VERIFICATION' as const, pan: 'ABCDE9999F',
      name: 'Test Rider A', dateOfBirth: '01/01/2000', consentId: consent.id };
    const first = await retryService.start(clientA, `pan-retry-${marker}`, input);
    expect(first.status).toBe('FAILED');
    const before = await prisma.featureUsageConsumption.count({ where: { verificationId: first.id } });
    expect(before).toBe(1);
    const result = await retryService.retry(clientA, first.id, `pan-technical-retry-${marker}`, input, 0);
    expect(result.verification.status).toBe('VERIFIED');
    expect(result.verification.attempts).toHaveLength(2);
    expect(await prisma.featureUsageConsumption.count({ where: { verificationId: first.id } })).toBe(1);
  });

  it('persists parallel disagreement and routes it to manual review', async () => {
    const sandbox = await prisma.kycProviderConfig.findUniqueOrThrow({ where: { code: 'SANDBOX' } });
    await prisma.kycRoutingPolicy.create({ data: { clientId: clientA, code: 'IFSC_TEST_ROUTING',
      name: 'IFSC test parallel', verificationType: 'IFSC_VERIFICATION', strategy: 'PARALLEL', version: 2,
      isDefault: true, maxProvidersPerVerification: 2, maxAttempts: 2, allowParallel: true,
      arbitrationMode: 'MANUAL_REVIEW_ON_CONFLICT',
      providers: { create: [{ providerId: sandbox.id, priority: 1 }, { providerId: testProviderId!, priority: 2 }] } } });
    const record = await service.start(clientA, `parallel-${marker}`, { riderId: riderA, type: 'IFSC_VERIFICATION', ifsc: 'HDFC0008888' });
    expect(record.status).toBe('MANUAL_REVIEW');
    expect(record.attempts).toHaveLength(2);
    expect(record.results).toHaveLength(2);
    expect(record.providerConflicts).toHaveLength(2);
    expect(record.finalProvider).toBeNull();
  });

  it('spends the final package credit once under concurrency and supports audited reversal', async () => {
    await prisma.clientFeature.updateMany({ where: { clientId: clientA, featureId }, data: { unlimitedUsage: false } });
    const lot = await prisma.featureCreditLot.create({ data: { clientId: clientA, subscriptionId,
      featureId, sourceType: 'PACKAGE_ALLOWANCE', sourceKey: `kyc-quota-${marker}`,
      quantityOriginal: 1, quantityAvailable: 1 } });
    const consent = await service.consent(clientA, { riderId: riderA, verificationType: 'PAN_VERIFICATION',
      consentVersion: 'v1', consentTextHash: 'b'.repeat(64), purpose: 'Rider identity verification',
      reason: 'Verify PAN for rider eligibility', accepted: true, channel: 'OPERATIONS_PANEL' });
    const input = { riderId: riderA, type: 'PAN_VERIFICATION' as const, pan: 'ABCDE1234F',
      name: 'Test Rider A', dateOfBirth: '01/01/2000', consentId: consent.id };
    const callsBefore = providerCalls;
    const attempts = await Promise.allSettled([
      service.start(clientA, `quota-a-${marker}`, input), service.start(clientA, `quota-b-${marker}`, input),
    ]);
    const success = attempts.find((item) => item.status === 'fulfilled');
    const denied = attempts.find((item) => item.status === 'rejected');
    expect(success?.status).toBe('fulfilled');
    expect(denied?.status).toBe('rejected');
    if (success?.status !== 'fulfilled' || denied?.status !== 'rejected') throw new Error('Quota race outcome missing');
    expect(String(denied.reason)).toContain('KYC_USAGE_LIMIT_EXCEEDED');
    expect(providerCalls - callsBefore).toBe(1);
    const consumed = await prisma.featureUsageConsumption.findUniqueOrThrow({ where: { verificationId: success.value.id } });
    expect(consumed.source).toBe('INCLUDED');
    expect((await prisma.featureCreditLot.findUniqueOrThrow({ where: { id: lot.id } })).quantityAvailable.toString()).toBe('0');
    const commercial = new KycCommercialService(prisma);
    await commercial.reverse(clientA, success.value.id, 'Duplicate request correction');
    expect((await prisma.featureCreditLot.findUniqueOrThrow({ where: { id: lot.id } })).quantityAvailable.toString()).toBe('1');
    await expect(commercial.reverse(clientA, success.value.id, 'Duplicate request correction')).rejects.toThrow('KYC_USAGE_ALREADY_REVERSED');
    const replay = await service.start(clientA, `quota-c-${marker}`, input);
    expect(replay.status).toBe('VERIFIED');
    expect((await prisma.featureUsageConsumption.findUniqueOrThrow({ where: { verificationId: replay.id } })).source).toBe('INCLUDED');
  });

  it('uses a purchased add-on credit after included credits are exhausted', async () => {
    const addOn = await prisma.featureAddOn.create({ data: { code: `KYC_TEST_ADDON_${marker}`,
      name: 'KYC test add-on', featureId, quantity: 1, salePrice: '5.0000' } });
    testAddOnId = addOn.id;
    const purchase = await prisma.clientFeatureAddOnPurchase.create({ data: { clientId: clientA, subscriptionId,
      featureAddOnId: addOn.id, featureId, quantityPurchased: 1, quantityRemaining: 1,
      amount: '5.00', totalAmount: '5.00', status: 'ACTIVE', validFrom: new Date('2026-01-01') } });
    await prisma.featureCreditLot.create({ data: { clientId: clientA, subscriptionId, featureId,
      purchaseId: purchase.id, sourceType: 'FEATURE_ADDON', sourceId: purchase.id,
      sourceKey: `kyc-addon-${marker}`, quantityOriginal: 1, quantityAvailable: 1 } });
    const consent = await service.consent(clientA, { riderId: riderA, verificationType: 'PAN_VERIFICATION',
      consentVersion: 'v1', consentTextHash: 'd'.repeat(64), purpose: 'Rider identity verification',
      reason: 'Verify PAN for rider eligibility', accepted: true, channel: 'OPERATIONS_PANEL' });
    const record = await service.start(clientA, `addon-${marker}`, { riderId: riderA,
      type: 'PAN_VERIFICATION', pan: 'ABCDE1234F', name: 'Test Rider A', dateOfBirth: '01/01/2000', consentId: consent.id });
    expect((await prisma.featureUsageConsumption.findUniqueOrThrow({ where: { verificationId: record.id } })).source).toBe('ADD_ON');
    const updated = await prisma.clientFeatureAddOnPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(updated.quantityConsumed.toString()).toBe('1');
    expect(updated.status).toBe('CONSUMED');
  });

  it('snapshots a discounted overage price without changing the feature catalog price', async () => {
    const clientFeature = await prisma.clientFeature.findFirstOrThrow({ where: { clientId: clientA, featureId } });
    const base = await prisma.featurePricing.create({ data: { featureId, billingUnit: 'VERIFICATION',
      salePrice: '12.5000', currency: 'INR', effectiveFrom: new Date(Date.now() - 1000) } });
    testFeaturePricingId = base.id;
    const clientPrice = await prisma.clientFeaturePricing.create({ data: { clientFeatureId: clientFeature.id,
      featurePricingId: base.id, listUnitPrice: '12.5000', finalUnitPrice: '10.2500',
      currency: 'INR', effectiveFrom: new Date(Date.now() - 1000) } });
    await prisma.kycClientPolicy.create({ data: { clientId: clientA, verificationType: 'PAN_VERIFICATION',
      overagePolicy: 'ALLOW_AND_CHARGE', usageRecognition: 'ON_REQUEST', validityDays: 30 } });
    const consent = await service.consent(clientA, { riderId: riderA, verificationType: 'PAN_VERIFICATION',
      consentVersion: 'v1', consentTextHash: 'c'.repeat(64), purpose: 'Rider identity verification',
      reason: 'Verify PAN for rider eligibility', accepted: true, channel: 'OPERATIONS_PANEL' });
    const record = await service.start(clientA, `overage-${marker}`, { riderId: riderA,
      type: 'PAN_VERIFICATION', pan: 'ABCDE1234F', name: 'Test Rider A', dateOfBirth: '01/01/2000', consentId: consent.id });
    const usage = await prisma.featureUsageConsumption.findUniqueOrThrow({ where: { verificationId: record.id } });
    expect((await prisma.kycVerification.findUniqueOrThrow({ where: { id: record.id } })).validUntil).not.toBeNull();
    expect(usage.source).toBe('OVERAGE');
    expect(usage.basePrice?.toString()).toBe('12.5');
    expect(usage.discount?.toString()).toBe('2.25');
    expect(usage.effectivePrice?.toString()).toBe('10.25');
    await prisma.clientFeaturePricing.update({ where: { id: clientPrice.id }, data: { finalUnitPrice: '8.0000' } });
    expect((await prisma.featureUsageConsumption.findUniqueOrThrow({ where: { verificationId: record.id } })).effectivePrice?.toString()).toBe('10.25');
    expect((await prisma.featurePricing.findUniqueOrThrow({ where: { id: base.id } })).salePrice.toString()).toBe('12.5');
  });

  it('applies a client feature adjustment to overage without changing base pricing', async () => {
    await prisma.clientFeaturePricing.deleteMany({ where: { clientFeature: { clientId: clientA, featureId } } });
    const adjustment = await prisma.clientPricingAdjustment.create({ data: { clientId: clientA,
      subscriptionId, adjustmentScope: 'FEATURE', referenceId: featureId, adjustmentType: 'PERCENTAGE',
      adjustmentValue: '20.0000', reason: 'KYC test client discount', validFrom: new Date('2026-01-01') } });
    testAdjustmentId = adjustment.id;
    const consent = await service.consent(clientA, { riderId: riderA, verificationType: 'PAN_VERIFICATION',
      consentVersion: 'v1', consentTextHash: 'f'.repeat(64), purpose: 'Rider identity verification',
      reason: 'Verify PAN for rider eligibility', accepted: true, channel: 'OPERATIONS_PANEL' });
    const record = await service.start(clientA, `adjustment-${marker}`, { riderId: riderA,
      type: 'PAN_VERIFICATION', pan: 'ABCDE1234F', name: 'Test Rider A', dateOfBirth: '01/01/2000', consentId: consent.id });
    const usage = await prisma.featureUsageConsumption.findUniqueOrThrow({ where: { verificationId: record.id } });
    expect(usage.source).toBe('OVERAGE');
    expect(usage.basePrice?.toString()).toBe('12.5');
    expect(usage.effectivePrice?.toString()).toBe('10');
  });

  it('fails closed before a provider call for an unsupported recognition configuration', async () => {
    await prisma.kycClientPolicy.updateMany({ where: { clientId: clientA, verificationType: 'PAN_VERIFICATION' },
      data: { usageRecognition: 'ON_SUCCESS' } });
    const consent = await service.consent(clientA, { riderId: riderA, verificationType: 'PAN_VERIFICATION',
      consentVersion: 'v1', consentTextHash: 'e'.repeat(64), purpose: 'Rider identity verification',
      reason: 'Verify PAN for rider eligibility', accepted: true, channel: 'OPERATIONS_PANEL' });
    const before = providerCalls;
    const verificationsBefore = await prisma.kycVerification.count({ where: { clientId: clientA } });
    await expect(service.start(clientA, `unsupported-${marker}`, { riderId: riderA,
      type: 'PAN_VERIFICATION', pan: 'ABCDE1234F', name: 'Test Rider A', dateOfBirth: '01/01/2000',
      consentId: consent.id })).rejects.toThrow('KYC_COMMERCIAL_CONFIGURATION_ERROR');
    expect(providerCalls).toBe(before);
    expect(await prisma.kycVerification.count({ where: { clientId: clientA } })).toBe(verificationsBefore);
  });
});
