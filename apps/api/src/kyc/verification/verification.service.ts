import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycType, KycVerificationStatus, KycVerificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Environment } from '../../config/environment.js';
import { ProviderRegistryService } from './provider-registry.service.js';
import { fingerprint, idempotencyFingerprint, safeVerificationData } from './kyc-security.js';
import { SandboxHttpError } from './sandbox-http.service.js';
import { KycRoutingEngine } from '../routing/kyc-routing.engine.js';
import type { ProviderResult } from './kyc-types.js';
import type { CreateConsentDto, StartVerificationDto } from './verification.dto.js';
import { KycCommercialService } from '../commercial/kyc-commercial.service.js';

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService, private readonly registry: ProviderRegistryService,
    private readonly config: ConfigService<Environment, true>, private readonly routing: KycRoutingEngine,
    private readonly commercial: KycCommercialService) {}

  async consent(clientId: string, dto: CreateConsentDto) {
    await this.assertRider(clientId, dto.riderId);
    if (!dto.accepted) throw new BadRequestException('KYC_CONSENT_REQUIRED');
    if (/\d{6,}|[A-Z]{5}\d{4}[A-Z]/i.test(`${dto.purpose} ${dto.reason}`))
      throw new BadRequestException('KYC_CONSENT_TEXT_CONTAINS_IDENTIFIER');
    return this.prisma.kycConsent.create({ data: { clientId, riderId: dto.riderId,
      verificationType: dto.verificationType, consentVersion: dto.consentVersion,
      consentTextHash: dto.consentTextHash, purpose: dto.purpose, reason: dto.reason,
      accepted: true, acceptedAt: new Date(), channel: dto.channel },
      select: { id: true, riderId: true, verificationType: true, acceptedAt: true, consentVersion: true } });
  }

  async start(clientId: string, key: string, dto: StartVerificationDto) {
    if (!this.config.get('KYC_ENABLED')) throw new ServiceUnavailableException('KYC_FEATURE_NOT_ENABLED');
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException('Idempotency-Key is required.');
    await this.assertRider(clientId, dto.riderId);
    const value = this.identityValue(dto);
    const secret = this.config.get('KYC_FINGERPRINT_SECRET');
    if (!secret) throw new ServiceUnavailableException('KYC_FEATURE_NOT_ENABLED');
    const inputFingerprint = fingerprint(secret, clientId, dto.riderId, dto.type, value);
    const idempotencyKey = idempotencyFingerprint(secret, clientId, key);
    const existing = await this.prisma.kycVerification.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey } } });
    if (existing) {
      if (existing.inputFingerprint !== inputFingerprint || existing.riderId !== dto.riderId || existing.verificationType !== dto.type || existing.consentId !== (dto.consentId ?? null))
        throw new ConflictException('Idempotency-Key was used for a different verification.');
      return this.get(clientId, existing.id);
    }
    const entitlement = await this.commercial.entitlement(clientId, dto.type);
    const consent = dto.consentId ? await this.prisma.kycConsent.findFirst({ where: { id: dto.consentId, clientId, riderId: dto.riderId, verificationType: dto.type, accepted: true, acceptedAt: { not: null } } }) : null;
    if (dto.type !== KycVerificationType.IFSC_VERIFICATION && !consent) throw new BadRequestException('KYC_CONSENT_REQUIRED');
    const plan = await this.routing.plan(clientId, dto.type, entitlement.policy?.routingPolicyId, idempotencyKey);
    let verification;
    try {
      verification = await this.prisma.$transaction(async (tx) => {
        const created = await tx.kycVerification.create({ data: { clientId, riderId: dto.riderId,
          verificationType: dto.type, status: 'PROCESSING', inputFingerprint, idempotencyKey,
          consentId: consent?.id, startedAt: new Date(),
          validityDaysSnapshot: entitlement.policy?.validityDays,
          reverificationRequiredSnapshot: entitlement.policy?.reverificationRequired ?? false } });
        await this.commercial.consume(tx, clientId, dto.type, created.id, entitlement);
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.kycVerification.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey } } });
        if (duplicate) return this.get(clientId, duplicate.id);
      }
      throw error;
    }
    try {
      const outcome = await this.routing.execute({ clientId, verificationId: verification.id, type: dto.type },
        { type: dto.type, pan: dto.pan, name: dto.name, dateOfBirth: dto.dateOfBirth, aadhaar: dto.aadhaar,
          accountNumber: dto.accountNumber, ifsc: dto.ifsc, reason: consent?.reason }, plan);
      await this.finish(verification.id, outcome.result, outcome.attemptId, outcome.providerId, true);
    } catch (error) {
      await this.failRouting(verification.id, error);
    }
    return this.get(clientId, verification.id);
  }

  async completeOtp(clientId: string, id: string, otp: string) {
    const verification = await this.prisma.kycVerification.findFirst({ where: { id, clientId }, include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } } });
    if (!verification) throw new NotFoundException('KYC_VERIFICATION_NOT_FOUND');
    if (verification.verificationType !== 'AADHAAR_OTP') throw new BadRequestException('KYC_INVALID_STATE');
    if (verification.expiresAt && verification.expiresAt < new Date()) {
      await this.prisma.kycVerification.updateMany({ where: { id, clientId, status: 'OTP_REQUIRED' },
        data: { status: 'EXPIRED', completedAt: new Date() } });
      throw new BadRequestException('KYC_OTP_EXPIRED');
    }
    const reference = verification.attempts[0]?.providerTransactionId;
    if (!reference) throw new ConflictException('KYC_INVALID_STATE');
    const selected = await this.registry.pinned(clientId, 'AADHAAR_OTP', verification.attempts[0].providerId);
    const changed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kycVerification.updateMany({ where: { id, clientId, status: 'OTP_REQUIRED' }, data: { status: 'PROCESSING' } });
      if (updated.count) await tx.kycVerificationAttempt.create({ data: { verificationId: id,
        providerId: selected.config.id, attemptNumber: 2, status: 'PROCESSING',
        cost: selected.capability.costPerRequest, currency: selected.capability.currency } });
      return updated.count;
    });
    if (!changed) throw new ConflictException('KYC_INVALID_STATE');
    try {
      const result = await selected.provider.completeAadhaarOtp(reference, otp, selected.capability.timeoutMs);
      const attempt = await this.prisma.kycVerificationAttempt.findUniqueOrThrow({ where: { verificationId_attemptNumber: { verificationId: id, attemptNumber: 2 } } });
      await this.finish(id, result, attempt.id, selected.config.id, false);
    } catch (error) { await this.failOtp(id, error); }
    return this.get(clientId, id);
  }

  async list(clientId: string, query: { status?: KycVerificationStatus; type?: KycVerificationType; skip?: number }) {
    return this.prisma.kycVerification.findMany({ where: { clientId, status: query.status, verificationType: query.type },
      select: { id: true, riderId: true, verificationType: true, status: true, requestedAt: true, completedAt: true,
        finalProvider: { select: { code: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: Math.min(query.skip ?? 0, 10000), take: 50 });
  }

  async get(clientId: string, id: string) {
    const record = await this.prisma.kycVerification.findFirst({ where: { id, clientId },
      select: { id: true, clientId: true, riderId: true, verificationType: true, status: true, recoveryVersion: true,
        resultCode: true, resultSummary: true, requestedAt: true, completedAt: true,
        finalProvider: { select: { code: true, name: true } },
        attempts: { orderBy: { attemptNumber: 'asc' }, select: { id: true, attemptNumber: true, status: true, latencyMs: true,
          reason: true, isLateCompletion: true, provider: { select: { code: true, name: true } },
          failureType: true, failureCategory: true, failureCode: true,
          requestStartedAt: true, responseReceivedAt: true } },
        results: { select: { status: true, normalizedData: true, verifiedAt: true } },
        routingDecision: { select: { routingPolicyVersion: true, strategy: true, selectedProviders: true,
          decisionReason: true, routingPolicy: { select: { code: true, name: true } } } },
        providerConflicts: { select: { provider: { select: { code: true } }, resultStatus: true,
          conflictType: true, resolution: true, createdAt: true } } } });
    if (!record) throw new NotFoundException('KYC_VERIFICATION_NOT_FOUND');
    const auditTimeline = await this.prisma.auditLog.findMany({ where: { clientId,
      entityType: 'KYC_VERIFICATION', entityId: id },
      select: { id: true, action: true, actorId: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, take: 100 });
    const routingTimeline = await this.prisma.auditLog.findMany({ where: { clientId,
      entityType: 'KYC_VERIFICATION', entityId: id,
      OR: [{ action: { startsWith: 'KYC_ROUTING_' } }, { action: { startsWith: 'KYC_PROVIDER_' } }] },
      select: { id: true, action: true, createdAt: true, newData: true }, orderBy: { createdAt: 'asc' }, take: 100 });
    return { ...record, auditTimeline, routingTimeline };
  }

  async retryPreview(clientId: string, id: string) {
    const record = await this.prisma.kycVerification.findFirst({ where: { id, clientId }, select: {
      id: true, status: true, verificationType: true, recoveryVersion: true,
      workflowStepExecution: { select: { id: true } },
      attempts: { select: { failureType: true, failureCategory: true }, orderBy: { attemptNumber: 'desc' } },
      routingDecision: { select: { routingPolicyId: true, routingPolicy: { select: { maxAttempts: true } } } },
    } });
    if (!record) throw new NotFoundException('KYC_VERIFICATION_NOT_FOUND');
    const budget = (record.routingDecision?.routingPolicy?.maxAttempts ?? 1) +
      this.config.get('KYC_OPS_MAX_TECHNICAL_RETRIES');
    const remaining = Math.max(0, budget - record.attempts.length);
    const technical = record.attempts[0]?.failureType === 'TECHNICAL_FAILURE';
    const stateless = record.verificationType !== 'AADHAAR_OTP';
    const enabled = this.config.get('KYC_ENABLED');
    const allowed = enabled && record.status === 'FAILED' && technical && stateless && !record.workflowStepExecution && remaining > 0;
    return { action: 'RETRY_VERIFICATION', allowed, expectedVersion: record.recoveryVersion,
      attemptsRemaining: remaining,
      reason: !enabled ? 'KYC verification is disabled.' :
        !stateless ? 'Aadhaar OTP requires its original provider session and cannot use stateless retry.' :
        record.workflowStepExecution ? 'Workflow-linked verification needs a new step execution and cannot use standalone retry.' :
        !technical ? 'Only a recorded technical provider failure is retryable.' :
          record.status !== 'FAILED' ? 'Verification is not in a failed terminal state.' :
            remaining <= 0 ? 'Technical retry attempt budget is exhausted.' :
              'Client must resubmit the original identity input. Routing and provider health are rechecked.',
      newProviderCallPossible: allowed, newClientUsagePossible: false, newVendorCostPossible: allowed };
  }

  async retry(clientId: string, id: string, key: string, dto: StartVerificationDto, expectedVersion: number) {
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException('Idempotency-Key is required.');
    const record = await this.prisma.kycVerification.findFirst({ where: { id, clientId }, select: {
      id: true, riderId: true, verificationType: true, consentId: true, inputFingerprint: true,
      consent: { select: { reason: true, accepted: true } },
      routingDecision: { select: { routingPolicyId: true } }, attempts: { select: { id: true } } } });
    if (!record) throw new NotFoundException('KYC_VERIFICATION_NOT_FOUND');
    if (record.riderId !== dto.riderId || record.verificationType !== dto.type ||
      record.consentId !== (dto.consentId ?? null)) throw new BadRequestException('KYC_RECOVERY_INPUT_MISMATCH');
    if (dto.type !== 'IFSC_VERIFICATION' && !record.consent?.accepted)
      throw new BadRequestException('KYC_CONSENT_REQUIRED');
    const secret = this.config.get('KYC_FINGERPRINT_SECRET');
    if (!secret) throw new ServiceUnavailableException('KYC_FEATURE_NOT_ENABLED');
    const inputFingerprint = fingerprint(secret, clientId, dto.riderId, dto.type, this.identityValue(dto));
    if (record.inputFingerprint !== inputFingerprint) throw new BadRequestException('KYC_RECOVERY_INPUT_MISMATCH');
    const keyHash = idempotencyFingerprint(secret, clientId, key);
    const existing = await this.prisma.kycRecoveryRequest.findUnique({ where: { clientId_keyHash: { clientId, keyHash } } });
    if (existing) {
      if (existing.verificationId !== id) throw new ConflictException('KYC_RECOVERY_IDEMPOTENCY_CONFLICT');
      return { verification: await this.get(clientId, id), replayed: true };
    }
    const preview = await this.retryPreview(clientId, id);
    if (!preview.allowed || preview.expectedVersion !== expectedVersion) throw new ConflictException('KYC_RECOVERY_NOT_AVAILABLE');
    const plan = await this.routing.plan(clientId, dto.type, record.routingDecision?.routingPolicyId, id);
    const recoveryPlan = { ...plan, maxAttempts: Math.min(plan.maxAttempts, preview.attemptsRemaining) };
    try {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.kycVerification.updateMany({ where: { id, clientId, status: 'FAILED',
          recoveryVersion: expectedVersion, inputFingerprint }, data: { status: 'PROCESSING',
          startedAt: new Date(), completedAt: null, recoveryVersion: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('KYC_RECOVERY_STALE');
        await tx.kycRecoveryRequest.create({ data: { clientId, verificationId: id, keyHash } });
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.kycRecoveryRequest.findUnique({ where: { clientId_keyHash: { clientId, keyHash } } });
        if (replay?.verificationId === id) return { verification: await this.get(clientId, id), replayed: true };
      }
      throw error;
    }
    try {
      const outcome = await this.routing.execute({ clientId, verificationId: id, type: dto.type },
        { type: dto.type, pan: dto.pan, name: dto.name, dateOfBirth: dto.dateOfBirth,
          accountNumber: dto.accountNumber, ifsc: dto.ifsc, reason: record.consent?.reason }, recoveryPlan,
        { attemptOffset: record.attempts.length });
      await this.finish(id, outcome.result, outcome.attemptId, outcome.providerId, true);
    } catch (error) { await this.failRouting(id, error); }
    return { verification: await this.get(clientId, id), replayed: false };
  }

  private async finish(id: string, result: ProviderResult, attemptId: string, providerId: string, alreadyPersisted: boolean) {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.kycVerification.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'PROCESSING') return;
      const now = new Date();
      if (!alreadyPersisted) {
        const attempt = await tx.kycVerificationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
        await tx.kycVerificationAttempt.update({ where: { id: attemptId }, data: { status: result.status,
          normalizedStatus: result.status, providerTransactionId: result.providerReference,
          responseReceivedAt: now, latencyMs: now.getTime() - attempt.requestStartedAt.getTime(),
          failureType: result.failureType, failureCategory: result.failureCategory, failureCode: result.failureCode } });
        await tx.kycVerificationResult.create({ data: { verificationId: id,
          attemptId, verificationType: current.verificationType, status: result.status,
          normalizedData: safeVerificationData(current.verificationType, result.data) as Prisma.InputJsonValue,
          verifiedAt: result.status === 'VERIFIED' ? now : null } });
      }
      const conflict = result.failureCode === 'PROVIDER_CONFLICT';
      const changed = await tx.kycVerification.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: result.status,
        finalAttemptId: conflict ? null : attemptId, finalProviderId: conflict ? null : providerId,
        resultCode: result.failureCode,
        expiresAt: result.status === 'OTP_REQUIRED' ? new Date(now.getTime() + 10 * 60 * 1000) : null,
        validUntil: result.status === 'VERIFIED' && current.validityDaysSnapshot
          ? new Date(now.getTime() + current.validityDaysSnapshot * 86_400_000) : null,
        completedAt: result.status === 'OTP_REQUIRED' ? null : now } });
      if (changed.count && result.status === 'VERIFIED') {
        const legacyType = current.verificationType === 'PAN_VERIFICATION' ? KycType.PAN
          : current.verificationType === 'AADHAAR_OTP' ? KycType.AADHAAR
          : current.verificationType === 'BANK_ACCOUNT_VERIFICATION' ? KycType.BANK_ACCOUNT : null;
        if (legacyType) {
          const provider = await tx.kycProviderConfig.findUniqueOrThrow({ where: { id: providerId }, select: { code: true } });
          await tx.riderKyc.upsert({ where: { riderId_type: { riderId: current.riderId, type: legacyType } },
            create: { clientId: current.clientId, riderId: current.riderId, type: legacyType,
              status: 'VERIFIED', provider: provider.code, verifiedAt: now },
            update: { status: 'VERIFIED', provider: provider.code, verifiedAt: now, safeFailureCode: null } });
        }
      }
    });
  }

  private async failRouting(id: string, error: unknown) {
    const category = error instanceof SandboxHttpError ? error.category : 'PROVIDER_ERROR';
    await this.prisma.kycVerification.updateMany({ where: { id, status: 'PROCESSING' }, data: {
      status: 'FAILED', resultCode: category, completedAt: new Date() } });
  }

  private async failOtp(id: string, error: unknown) {
    const category = error instanceof SandboxHttpError ? error.category : 'PROVIDER_ERROR';
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.kycVerification.findUniqueOrThrow({ where: { id }, include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } } });
      if (current.status !== 'PROCESSING') return;
      const attempt = current.attempts[0]!;
      const now = new Date();
      await tx.kycVerificationAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED',
        normalizedStatus: 'FAILED', failureType: ['DOCUMENT_INVALID', 'OTP_FAILED'].includes(category) ? 'BUSINESS_FAILURE' : 'TECHNICAL_FAILURE',
        failureCategory: category, failureCode: category, responseReceivedAt: now,
        latencyMs: now.getTime() - attempt.requestStartedAt.getTime() } });
      await tx.kycVerification.update({ where: { id }, data: { status: 'FAILED', resultCode: category,
        finalAttemptId: attempt.id, completedAt: now } });
    });
  }

  private identityValue(dto: StartVerificationDto) {
    switch (dto.type) {
      case 'PAN_VERIFICATION': if (dto.pan && dto.name && dto.dateOfBirth) return `${dto.pan}|${dto.name}|${dto.dateOfBirth}`; break;
      case 'AADHAAR_OTP': if (dto.aadhaar) return dto.aadhaar; break;
      case 'BANK_ACCOUNT_VERIFICATION': if (dto.accountNumber && dto.ifsc) return `${dto.accountNumber}|${dto.ifsc}`; break;
      case 'IFSC_VERIFICATION': if (dto.ifsc) return dto.ifsc; break;
    }
    throw new BadRequestException('KYC_INVALID_INPUT');
  }

  private async assertRider(clientId: string, riderId: string) {
    if (!await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true } }))
      throw new NotFoundException('Rider not found.');
  }

}
