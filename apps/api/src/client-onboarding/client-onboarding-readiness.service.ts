import { Injectable } from '@nestjs/common';
import {
  ClientDocumentType,
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  ClientStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type OnboardingReadinessIssue = { code: string; message: string };

@Injectable()
export class ClientOnboardingReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async operational(clientId: string): Promise<OnboardingReadinessIssue[]> {
    const [hubs, managers, fleets, progress] = await Promise.all([
      this.prisma.hub.count({ where: { clientId, deletedAt: null } }),
      this.prisma.user.count({ where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true, deletedAt: null } }),
      this.prisma.fleet.count({ where: { clientId, deletedAt: null } }),
      this.prisma.clientOnboardingProgress.findUnique({ where: { clientId }, include: { steps: true } }),
    ]);
    const issues: OnboardingReadinessIssue[] = [];
    if (!hubs) issues.push({ code: 'HUB_REQUIRED', message: 'Create at least one Hub.' });
    if (!managers) issues.push({ code: 'FLEET_MANAGER_REQUIRED', message: 'Create at least one active Fleet Manager.' });
    if (!fleets) issues.push({ code: 'FLEET_REQUIRED', message: 'Create at least one Fleet.' });
    const required = [ClientOnboardingStep.HUBS, ClientOnboardingStep.FLEET_MANAGERS, ClientOnboardingStep.FLEETS];
    for (const step of required) {
      const record = progress?.steps.find((item) => item.step === step);
      if (!record || record.status !== ClientOnboardingStepStatus.COMPLETED)
        issues.push({ code: `${step}_INCOMPLETE`, message: `${step.replaceAll('_', ' ')} onboarding step is incomplete.` });
    }
    for (const step of [ClientOnboardingStep.TEAM_LEADERS, ClientOnboardingStep.RIDERS]) {
      const record = progress?.steps.find((item) => item.step === step);
      if (record && record.status !== ClientOnboardingStepStatus.COMPLETED && record.status !== ClientOnboardingStepStatus.SKIPPED)
        issues.push({ code: `${step}_INCOMPLETE`, message: `${step.replaceAll('_', ' ')} must be completed or skipped.` });
    }
    return issues;
  }

  async activation(clientId: string): Promise<OnboardingReadinessIssue[]> {
    const issues = await this.operational(clientId);
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { businessProfile: true, contacts: true, addresses: true, operationsProfile: true, billingProfile: true, agreement: true, subscriptions: true, documents: true },
    });
    if (!client) return [{ code: 'CLIENT_NOT_FOUND', message: 'Client not found.' }];
    if (!client.businessProfile) issues.push({ code: 'BUSINESS_PROFILE_REQUIRED', message: 'Business profile is incomplete.' });
    if (!client.operationsProfile) issues.push({ code: 'OPERATIONS_PROFILE_REQUIRED', message: 'Fleet operations profile is incomplete.' });
    if (!client.billingProfile) issues.push({ code: 'BILLING_PROFILE_REQUIRED', message: 'Billing profile is incomplete.' });
    if (!client.agreement || !client.agreement.termsAcceptedAt || !client.agreement.privacyAcceptedAt || !client.agreement.dataProcessingConsentAt)
      issues.push({ code: 'AGREEMENT_REQUIRED', message: 'Required agreement consents are incomplete.' });
    if (!client.subscriptions.some((subscription) => subscription.status === 'ACTIVE'))
      issues.push({ code: 'SUBSCRIPTION_REQUIRED', message: 'An active client subscription is required.' });
    if (!client.contacts.some((contact) => contact.role === 'PRIMARY')) issues.push({ code: 'PRIMARY_CONTACT_REQUIRED', message: 'Primary contact is required.' });
    if (!client.contacts.some((contact) => contact.role === 'ACCOUNT_ADMIN')) issues.push({ code: 'ACCOUNT_ADMIN_REQUIRED', message: 'Account Admin contact is required.' });
    if (!client.addresses.some((address) => address.type === 'REGISTERED')) issues.push({ code: 'REGISTERED_ADDRESS_REQUIRED', message: 'Registered address is required.' });
    if (!client.addresses.some((address) => address.type === 'BILLING')) issues.push({ code: 'BILLING_ADDRESS_REQUIRED', message: 'Billing address is required.' });
    const pan = client.documents.find((document) => document.documentType === ClientDocumentType.PAN_CARD && document.uploadedAt && document.verificationStatus === 'VERIFIED');
    if (!pan) issues.push({ code: 'PAN_REQUIRED', message: 'A valid uploaded PAN document is required.' });
    return issues;
  }
}
