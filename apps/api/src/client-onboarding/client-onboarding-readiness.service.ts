import { Injectable } from '@nestjs/common';
import {
  ClientDocumentType,
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type OnboardingReadinessIssue = { code: string; message: string; owner: 'CLIENT_ADMIN' | 'SUPER_ADMIN'; navigationTarget?: string };

@Injectable()
export class ClientOnboardingReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(clientId: string) {
    await this.reconcileSteps(clientId);
    const [issues, progress] = await Promise.all([this.activation(clientId), this.prisma.clientOnboardingProgress.findUnique({ where: { clientId }, include: { steps: true } })]);
    return { clientId, ready: issues.length === 0, issues, steps: progress?.steps ?? [], generatedAt: new Date().toISOString() };
  }

  async reconcileSteps(clientId: string) {
    const progress = await this.prisma.clientOnboardingProgress.findUnique({ where: { clientId }, include: { steps: true } });
    if (!progress) return;
    const [hubs, managers, fleets] = await Promise.all([
      this.prisma.hub.count({ where: { clientId, deletedAt: null } }),
      this.prisma.user.count({ where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true, deletedAt: null } }),
      this.prisma.fleet.count({ where: { clientId, deletedAt: null } }),
    ]);
    const counts = new Map([[ClientOnboardingStep.HUBS, hubs], [ClientOnboardingStep.FLEET_MANAGERS, managers], [ClientOnboardingStep.FLEETS, fleets]]);
    await Promise.all([...counts.entries()].map(([step, count]) => this.prisma.clientOnboardingStepRecord.updateMany({ where: { progressId: progress.id, step, status: { not: ClientOnboardingStepStatus.SKIPPED } }, data: count > 0 ? { status: ClientOnboardingStepStatus.COMPLETED, completedAt: new Date(), savedAt: new Date() } : { status: ClientOnboardingStepStatus.NOT_STARTED, completedAt: null } })));
  }

  async operational(clientId: string): Promise<OnboardingReadinessIssue[]> {
    const [hubs, managers, fleets, progress] = await Promise.all([
      this.prisma.hub.count({ where: { clientId, deletedAt: null } }),
      this.prisma.user.count({ where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true, deletedAt: null } }),
      this.prisma.fleet.count({ where: { clientId, deletedAt: null } }),
      this.prisma.clientOnboardingProgress.findUnique({ where: { clientId }, include: { steps: true } }),
    ]);
    const issues: OnboardingReadinessIssue[] = [];
    if (!hubs) issues.push({ code: 'HUB_REQUIRED', message: 'Create at least one Hub.', owner: 'CLIENT_ADMIN' });
    if (!managers) issues.push({ code: 'FLEET_MANAGER_REQUIRED', message: 'Create at least one active Fleet Manager.', owner: 'CLIENT_ADMIN' });
    if (!fleets) issues.push({ code: 'FLEET_REQUIRED', message: 'Create at least one Fleet.', owner: 'CLIENT_ADMIN' });
    const required = [ClientOnboardingStep.HUBS, ClientOnboardingStep.FLEET_MANAGERS, ClientOnboardingStep.FLEETS];
    for (const step of required) {
      const record = progress?.steps.find((item) => item.step === step);
      if (!record || record.status !== ClientOnboardingStepStatus.COMPLETED)
        issues.push({ code: `${step}_INCOMPLETE`, message: `${step.replaceAll('_', ' ')} onboarding step is incomplete.`, owner: 'CLIENT_ADMIN' });
    }
    for (const step of [ClientOnboardingStep.TEAM_LEADERS, ClientOnboardingStep.RIDERS]) {
      const record = progress?.steps.find((item) => item.step === step);
      if (record && record.status !== ClientOnboardingStepStatus.COMPLETED && record.status !== ClientOnboardingStepStatus.SKIPPED)
        issues.push({ code: `${step}_INCOMPLETE`, message: `${step.replaceAll('_', ' ')} must be completed or skipped.`, owner: 'CLIENT_ADMIN' });
    }
    return issues;
  }

  async activation(clientId: string): Promise<OnboardingReadinessIssue[]> {
    const issues = await this.operational(clientId);
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { businessProfile: true, contacts: true, addresses: true, operationsProfile: true, billingProfile: true, agreement: true, subscriptions: true, documents: true },
    });
    if (!client) return [{ code: 'CLIENT_NOT_FOUND', message: 'Client not found.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients' }];
    if (!client.businessProfile) issues.push({ code: 'BUSINESS_PROFILE_REQUIRED', message: 'Business profile is incomplete.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=business' });
    if (!client.operationsProfile) issues.push({ code: 'OPERATIONS_PROFILE_REQUIRED', message: 'Fleet operations profile is incomplete.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=operations' });
    if (!client.billingProfile) issues.push({ code: 'BILLING_PROFILE_REQUIRED', message: 'Billing profile is incomplete.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=billing' });
    if (!client.agreement || !client.agreement.termsAcceptedAt || !client.agreement.privacyAcceptedAt || !client.agreement.dataProcessingConsentAt)
      issues.push({ code: 'AGREEMENT_REQUIRED', message: 'Required agreement consents are incomplete.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=agreements' });
    if (!client.subscriptions.some((subscription) => subscription.status === 'ACTIVE' || subscription.status === 'PENDING'))
      issues.push({ code: 'SUBSCRIPTION_REQUIRED', message: 'A client subscription is required.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=subscription' });
    if (!client.contacts.some((contact) => contact.role === 'PRIMARY')) issues.push({ code: 'PRIMARY_CONTACT_REQUIRED', message: 'Primary contact is required.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=contacts' });
    if (!client.contacts.some((contact) => contact.role === 'ACCOUNT_ADMIN')) issues.push({ code: 'ACCOUNT_ADMIN_REQUIRED', message: 'Account Admin contact is required.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=contacts' });
    if (!client.addresses.some((address) => address.type === 'REGISTERED')) issues.push({ code: 'REGISTERED_ADDRESS_REQUIRED', message: 'Registered address is required.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=addresses' });
    if (!client.addresses.some((address) => address.type === 'BILLING')) issues.push({ code: 'BILLING_ADDRESS_REQUIRED', message: 'Billing address is required.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=addresses' });
    const pan = client.documents.find((document) => document.documentType === ClientDocumentType.PAN_CARD && document.uploadedAt && document.verificationStatus === 'VERIFIED');
    if (!pan) issues.push({ code: 'PAN_REQUIRED', message: 'A valid uploaded PAN document is required.', owner: 'SUPER_ADMIN', navigationTarget: '/platform/clients?section=documents' });
    return issues;
  }
}
