import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  ClientStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientOnboardingReadinessService } from './client-onboarding-readiness.service.js';
import { AuditService } from '../audit/audit.service.js';

const steps = [
  ClientOnboardingStep.HUBS,
  ClientOnboardingStep.FLEET_MANAGERS,
  ClientOnboardingStep.TEAM_LEADERS,
  ClientOnboardingStep.FLEETS,
  ClientOnboardingStep.RIDERS,
  ClientOnboardingStep.REVIEW,
];
const optionalSteps = new Set<ClientOnboardingStep>([
  ClientOnboardingStep.TEAM_LEADERS,
  ClientOnboardingStep.RIDERS,
]);

@Injectable()
export class ClientOnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly readiness?: ClientOnboardingReadinessService, private readonly audit?: AuditService) {}

  async bootstrap(clientId: string) {
    const [client, progress, rejection, corrections] = await Promise.all([
      this.prisma.client.findUniqueOrThrow({
        where: { id: clientId },
        select: {
          id: true,
          name: true,
          companyCode: true,
          status: true,
          isActive: true,
          fleetOperatingMode: true,
          agreement: {
            select: {
              rejectionReason: true,
              rejectedAt: true,
            },
          },
        },
      }),
      this.progress(clientId),
      this.prisma.auditLog.findFirst({
        where: { clientId, action: 'CLIENT_REJECTED', entityType: 'Client' },
        orderBy: { createdAt: 'desc' },
        select: { newData: true, createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { clientId, action: 'CLIENT_ONBOARDING_CORRECTION_SAVED', entityType: 'ClientOnboardingCorrection' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, newData: true },
      }),
    ]);
    const rejectionItems = await this.prisma.clientOnboardingRejection.findMany({
      where: { clientId, blocking: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      client: {
        ...client,
        rejectionReason: client.agreement?.rejectionReason ?? null,
        rejectedAt: client.agreement?.rejectedAt ?? null,
        rejection: rejectionItems.length
          ? { items: rejectionItems, resolved: rejectionItems.every((item) => Boolean(item.resolvedAt)) }
          : rejection
            ? { ...(rejection.newData as Record<string, unknown>), rejectedAt: rejection.createdAt, resolved: this.rejectionResolved(rejection, corrections) }
          : null,
        agreement: undefined,
      },
      progress,
      route: this.routeFor(client.status),
    };
  }

  async progress(clientId: string) {
    const progress = await this.prisma.clientOnboardingProgress.upsert({
      where: { clientId },
      create: {
        clientId,
        steps: { create: steps.map((step) => ({ clientId, step })) },
      },
      update: {},
      include: { steps: { orderBy: { createdAt: 'asc' } } },
    });
    return {
      ...progress,
      steps: steps.map(
        (step) => progress.steps.find((item) => item.step === step)!,
      ),
    };
  }

  async saveStep(
    clientId: string,
    actorId: string,
    step: ClientOnboardingStep,
    status: ClientOnboardingStepStatus,
  ) {
    await this.assertEditable(clientId);
    if (
      status === ClientOnboardingStepStatus.SKIPPED &&
      !optionalSteps.has(step as 'TEAM_LEADERS' | 'RIDERS')
    ) {
      throw new BadRequestException('This onboarding step cannot be skipped.');
    }
    const progress = await this.progress(clientId);
    const current = progress.steps.find((item) => item.step === step);
    if (!current) throw new BadRequestException('Unknown onboarding step.');
    if (status === ClientOnboardingStepStatus.COMPLETED) {
      const index = steps.indexOf(step);
      const blocked = steps.slice(0, index).some((requiredStep) => {
        if (optionalSteps.has(requiredStep)) return false;
        const record = progress.steps.find((item) => item.step === requiredStep);
        return !record || record.status !== ClientOnboardingStepStatus.COMPLETED;
      });
      if (blocked)
        throw new BadRequestException('Complete the previous required onboarding steps first.');
    }
    const now = new Date();
    const next = this.nextStep(
      progress.steps.map((item) =>
        item.step === step ? { ...item, status } : item,
      ),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.clientOnboardingStepRecord.update({
        where: { progressId_step: { progressId: progress.id, step } },
        data: {
          status,
          savedAt: now,
          completedAt:
            status === ClientOnboardingStepStatus.COMPLETED ? now : null,
          skippedAt: status === ClientOnboardingStepStatus.SKIPPED ? now : null,
          updatedById: actorId,
        },
      });
      await tx.clientOnboardingProgress.update({
        where: { id: progress.id },
        data: { currentStep: next },
      });
    });
    await this.prisma.clientOnboardingRejection.updateMany({
      where: { clientId, section: this.sectionForStep(step), blocking: true, resolvedAt: null },
      data: { resolvedAt: now, resolvedById: actorId },
    });
    await this.audit?.record({ clientId, actorId, action: 'CLIENT_ONBOARDING_CORRECTION_SAVED', entityType: 'ClientOnboardingCorrection', entityId: clientId, newData: { section: step } });
    return this.progress(clientId);
  }

  async submit(clientId: string, actorId: string) {
    await this.assertEditable(clientId);
    const issues = this.readiness ? await this.readiness.operational(clientId) : [];
    if (issues.length) throw new BadRequestException({ code: 'ONBOARDING_NOT_READY', issues });
    const rejection = await this.prisma.auditLog.findFirst({
      where: { clientId, action: 'CLIENT_REJECTED', entityType: 'Client' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (rejection) {
      const corrections = await this.prisma.auditLog.findMany({
        where: { clientId, action: 'CLIENT_ONBOARDING_CORRECTION_SAVED', entityType: 'ClientOnboardingCorrection', createdAt: { gt: rejection.createdAt } },
        select: { newData: true },
      });
      if (!corrections.length) throw new BadRequestException('Resolve the requested onboarding corrections before resubmitting.');
    }
    const openRejections = await this.prisma.clientOnboardingRejection.count({ where: { clientId, blocking: true, resolvedAt: null } });
    if (openRejections) throw new BadRequestException('Resolve all requested onboarding corrections before resubmitting.');
    const progress = await this.progress(clientId);
    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id: clientId },
        data: { status: ClientStatus.PENDING_APPROVAL },
      }),
      this.prisma.clientAgreement.updateMany({
        where: { clientId },
        data: {
          rejectedAt: null,
          rejectedById: null,
          rejectionReason: null,
        },
      }),
      this.prisma.clientOnboardingProgress.update({
        where: { id: progress.id },
        data: {
          currentStep: ClientOnboardingStep.REVIEW,
          submittedAt: new Date(),
        },
      }),
      this.prisma.clientOnboardingStepRecord.update({
        where: {
          progressId_step: {
            progressId: progress.id,
            step: ClientOnboardingStep.REVIEW,
          },
        },
        data: {
          status: ClientOnboardingStepStatus.COMPLETED,
          completedAt: new Date(),
          savedAt: new Date(),
          updatedById: actorId,
        },
      }),
    ]);
    await this.audit?.record({
      clientId,
      actorId,
      action: 'CLIENT_ONBOARDING_SUBMITTED',
      entityType: 'ClientOnboardingSubmission',
      entityId: clientId,
      newData: {
        submittedAt: new Date().toISOString(),
        steps: progress.steps.map((item) => ({ step: item.step, status: item.status })),
        readinessIssues: [],
      },
    });
    return this.bootstrap(clientId);
  }

  async dashboard(clientId: string) {
    const [
      hubs,
      fleets,
      riders,
      fleetManagers,
      teamLeaders,
      activeAllocations,
      fleetGroups,
      riderGroups,
    ] = await Promise.all([
      this.prisma.hub.count({ where: { clientId, deletedAt: null } }),
      this.prisma.fleet.count({ where: { clientId, deletedAt: null } }),
      this.prisma.rider.count({ where: { clientId, deletedAt: null } }),
      this.prisma.user.count({
        where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true },
      }),
      this.prisma.user.count({
        where: { clientId, role: UserRole.TEAM_LEAD, isActive: true },
      }),
      this.prisma.allocation.count({
        where: {
          clientId,
          status: {
            in: [
              'INSPECTION_PENDING',
              'OTP_PENDING',
              'ACTIVE',
              'DEALLOCATION_INITIATED',
            ],
          },
        },
      }),
      this.prisma.fleet.groupBy({
        by: ['status'],
        where: { clientId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.rider.groupBy({
        by: ['status'],
        where: { clientId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const map = <T extends { status: string; _count: { _all: number } }>(
      items: T[],
    ) =>
      Object.fromEntries(items.map((item) => [item.status, item._count._all]));
    return {
      hubs,
      fleets,
      riders,
      fleetManagers,
      teamLeaders,
      activeAllocations,
      fleetByStatus: map(fleetGroups),
      riderByStatus: map(riderGroups),
    };
  }

  private async assertEditable(clientId: string) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { status: true },
    });
    if (
      client.status !== ClientStatus.CREATED &&
      client.status !== ClientStatus.REJECTED
    )
      throw new ForbiddenException(
        'Onboarding is read-only while the client workspace is under review or inactive.',
      );
  }

  private nextStep(
    records: {
      step: ClientOnboardingStep;
      status: ClientOnboardingStepStatus;
    }[],
  ) {
    return (
      steps.find((step) => {
        const status = records.find((record) => record.step === step)?.status;
        return (
          status !== ClientOnboardingStepStatus.COMPLETED &&
          status !== ClientOnboardingStepStatus.SKIPPED
        );
      }) ?? ClientOnboardingStep.REVIEW
    );
  }

  private routeFor(status: ClientStatus) {
    if (status === ClientStatus.ACTIVE) return 'DASHBOARD';
    if (
      status === ClientStatus.CREATED ||
      status === ClientStatus.REJECTED
    )
      return 'ONBOARDING';
    if (status === ClientStatus.PENDING_APPROVAL) return 'WAITING';
    return 'SUSPENDED';
  }

  private rejectionResolved(
    rejection: { newData: unknown },
    corrections: Array<{ newData: unknown }>,
  ) {
    const data = (rejection.newData ?? {}) as { section?: string };
    if (!data.section || data.section === 'GENERAL') return corrections.length > 0;
    return corrections.some((correction) =>
      (correction.newData as { section?: string } | null)?.section === data.section,
    );
  }

  private sectionForStep(step: ClientOnboardingStep) {
    return step === ClientOnboardingStep.HUBS ? 'HUBS'
      : step === ClientOnboardingStep.FLEET_MANAGERS ? 'FLEET_MANAGERS'
        : step === ClientOnboardingStep.FLEETS ? 'FLEETS'
          : step === ClientOnboardingStep.RIDERS ? 'RIDERS'
            : step === ClientOnboardingStep.TEAM_LEADERS ? 'TEAM_LEADERS' : 'GENERAL';
  }
}
