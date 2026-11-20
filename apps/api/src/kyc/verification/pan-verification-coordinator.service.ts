import { PanVerificationPolicyService } from '../../riders/pan-verification-policy.service.js';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { VerificationService } from './verification.service.js';

export type PanVerificationReadiness = {
  status: 'DISABLED' | 'WAITING_FOR_RIDER' | 'WAITING_FOR_INPUT' | 'WAITING_FOR_CONSENT' | 'READY';
  reason: string;
  pan?: string;
  name?: string;
  dateOfBirth?: string;
};

/** Backend trigger boundary; it never calls a vendor or consumes credits. */
@Injectable()
export class PanVerificationCoordinator {
  constructor(private readonly prisma: PrismaService, private readonly verification: VerificationService, private readonly panPolicy: PanVerificationPolicyService) {}

  async readiness(clientId: string, userId: string): Promise<PanVerificationReadiness> {
    const [automated, progress, rider] = await Promise.all([
      this.panPolicy.automated(clientId),
      this.prisma.riderOnboardingProgress.findFirst({ where: { clientId, userId }, select: { values: true } }),
      this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!automated) return { status: 'DISABLED', reason: 'Automated PAN verification is disabled; manual document review applies.' };
    if (!rider) return { status: 'WAITING_FOR_RIDER', reason: 'The rider record is created after onboarding is complete.' };
    const values = progress?.values && typeof progress.values === 'object' && !Array.isArray(progress.values) ? progress.values as Record<string, unknown> : {};
    const pan = typeof values.PAN_NUMBER === 'string' ? values.PAN_NUMBER.trim().toUpperCase() : '';
    const name = typeof values.FULL_NAME === 'string' ? values.FULL_NAME.trim() : '';
    const dateOfBirth = typeof values.DATE_OF_BIRTH === 'string' ? values.DATE_OF_BIRTH.trim() : '';
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) || !name || !dateOfBirth) return { status: 'WAITING_FOR_INPUT', reason: 'PAN, name, and date of birth are required.' };
    const consent = await this.prisma.kycConsent.findFirst({ where: { clientId, riderId: rider.id, verificationType: 'PAN_VERIFICATION', accepted: true, acceptedAt: { not: null } }, select: { id: true } });
    if (!consent) {
      const legal = await this.prisma.appLegalAcceptance.findFirst({ where: { clientId, userId, document: { appCode: 'RIDER', role: 'RIDER', kind: 'PRIVACY_CONSENT' } }, orderBy: { acceptedAt: 'desc' }, select: { contentHash: true, document: { select: { version: true } } } });
      if (!legal) return { status: 'WAITING_FOR_CONSENT', reason: 'Rider login consent is required.' };
    }
    return { status: 'READY', reason: 'PAN verification prerequisites are satisfied.', pan, name, dateOfBirth };
  }

  async startIfReady(clientId: string, userId: string) {
    const ready = await this.readiness(clientId, userId);
    if (ready.status !== 'READY' || !ready.pan || !ready.name || !ready.dateOfBirth) return ready;
    const rider = await this.prisma.rider.findFirstOrThrow({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    let consent = await this.prisma.kycConsent.findFirst({ where: { clientId, riderId: rider.id, verificationType: 'PAN_VERIFICATION', accepted: true, acceptedAt: { not: null } }, select: { id: true } });
    if (!consent) {
      const legal = await this.prisma.appLegalAcceptance.findFirstOrThrow({ where: { clientId, userId, document: { appCode: 'RIDER', role: 'RIDER', kind: 'PRIVACY_CONSENT' } }, orderBy: { acceptedAt: 'desc' }, select: { contentHash: true, document: { select: { version: true } } } });
      consent = await this.prisma.kycConsent.create({ data: { clientId, riderId: rider.id, verificationType: 'PAN_VERIFICATION', consentVersion: legal.document.version, consentTextHash: legal.contentHash, purpose: 'Rider onboarding identity verification', reason: 'For rider onboarding', accepted: true, acceptedAt: new Date(), channel: 'RIDER_LOGIN' }, select: { id: true } });
    }
    const dateOfBirth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ready.dateOfBirth);
    const formattedDob = dateOfBirth ? `${dateOfBirth[3]}/${dateOfBirth[2]}/${dateOfBirth[1]}` : ready.dateOfBirth;
    return this.verification.start(clientId, `rider-pan:${userId}:${ready.pan}:${ready.dateOfBirth}`, { riderId: rider.id, type: 'PAN_VERIFICATION', pan: ready.pan, name: ready.name, dateOfBirth: formattedDob, consentId: consent.id });
  }
}
