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
    await this.readiness?.reconcileSteps(clientId);
    const [client, progress] = await Promise.all([
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
    ]);
    const rejectionItems = await this.prisma.clientOnboardingRejection.findMany({
      where: { clientId, blocking: true },
      orderBy: { createdAt: 'desc' },
    });
    const latestRejection = rejectionItems[0] ?? null;
    const readiness = this.readiness ? await this.readiness.activation(clientId) : [];
    return {
      client: {
        ...client,
        rejectionReason: client.agreement?.rejectionReason ?? null,
        rejectedAt: client.agreement?.rejectedAt ?? null,
        rejection: rejectionItems.length
          ? {
              items: rejectionItems,
              resolved: rejectionItems.every((item) => Boolean(item.resolvedAt)),
              section: latestRejection?.section ?? null,
              reasonCode: latestRejection?.reasonCode ?? null,
              reason: latestRejection?.reason ?? null,
              rejectedAt: latestRejection?.createdAt ?? null,
            }
          : null,
        agreement: undefined,
      },
      progress,
      readiness: { ready: readiness.length === 0, issues: readiness },
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
    const existing = new Set(progress.steps.map((item) => item.step));
    const missing = steps.filter((step) => !existing.has(step));
    if (missing.length) {
      await this.prisma.clientOnboardingStepRecord.createMany({
        data: missing.map((step) => ({ clientId, progressId: progress.id, step })),
        skipDuplicates: true,
      });
      const repaired = await this.prisma.clientOnboardingProgress.findUniqueOrThrow({
        where: { id: progress.id },
        include: { steps: { orderBy: { createdAt: 'asc' } } },
      });
      await this.syncDerivedSteps(clientId, progress.id, repaired.steps);
      return {
        ...repaired,
        steps: steps.map((step) => repaired.steps.find((item) => item.step === step)!).filter(Boolean),
      };
    }
    await this.syncDerivedSteps(clientId, progress.id, progress.steps);
    return {
      ...progress,
      steps: steps.map(
        (step) => progress.steps.find((item) => item.step === step)!,
      ),
    };
  }

  private async syncDerivedSteps(clientId: string, progressId: string, records: { step: ClientOnboardingStep; status: ClientOnboardingStepStatus }[]) {
    const [hubs, fleetManagers, fleets] = await Promise.all([
      this.prisma.hub.count({ where: { clientId, deletedAt: null } }),
      this.prisma.user.count({ where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true, deletedAt: null } }),
      this.prisma.fleet.count({ where: { clientId, deletedAt: null } }),
    ]);
    const counts: Partial<Record<ClientOnboardingStep, number>> = {
      [ClientOnboardingStep.HUBS]: hubs,
      [ClientOnboardingStep.FLEET_MANAGERS]: fleetManagers,
      [ClientOnboardingStep.FLEETS]: fleets,
    };
    const now = new Date();
    for (const step of [ClientOnboardingStep.HUBS, ClientOnboardingStep.FLEET_MANAGERS, ClientOnboardingStep.FLEETS]) {
      const current = records.find((record) => record.step === step);
      if (!current || counts[step] === undefined) continue;
      const nextStatus = counts[step]! > 0 ? ClientOnboardingStepStatus.COMPLETED : current.status === ClientOnboardingStepStatus.COMPLETED ? ClientOnboardingStepStatus.IN_PROGRESS : current.status;
      if (nextStatus === current.status) continue;
      await this.prisma.clientOnboardingStepRecord.update({
        where: { progressId_step: { progressId, step } },
        data: { status: nextStatus, savedAt: now, completedAt: nextStatus === ClientOnboardingStepStatus.COMPLETED ? now : null },
      });
    }
  }

  async saveStep(
    clientId: string,
    actorId: string,
    step: ClientOnboardingStep,
    status: ClientOnboardingStepStatus,
  ) {
    const clientStatus = await this.assertEditable(clientId);
    if (
      status === ClientOnboardingStepStatus.SKIPPED &&
      !optionalSteps.has(step as 'TEAM_LEADERS' | 'RIDERS')
    ) {
      throw new BadRequestException('This onboarding step cannot be skipped.');
    }
    const progress = await this.progress(clientId);
    const current = progress.steps.find((item) => item.step === step);
    if (!current) throw new BadRequestException('Unknown onboarding step.');
    const movingBackward =
      current.status === ClientOnboardingStepStatus.COMPLETED &&
      status !== ClientOnboardingStepStatus.COMPLETED;
    if (movingBackward && clientStatus !== ClientStatus.REJECTED) {
      throw new BadRequestException(
        'Completed onboarding steps can only be changed while correcting a rejected submission.',
      );
    }
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
        where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true, deletedAt: null },
      }),
      this.prisma.user.count({
        where: { clientId, role: UserRole.TEAM_LEAD, isActive: true, deletedAt: null },
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

  private async assertEditable(clientId: string): Promise<ClientStatus> {
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
    return client.status;
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

  private sectionForStep(step: ClientOnboardingStep) {
    return step === ClientOnboardingStep.HUBS ? 'HUBS'
      : step === ClientOnboardingStep.FLEET_MANAGERS ? 'FLEET_MANAGERS'
        : step === ClientOnboardingStep.FLEETS ? 'FLEETS'
          : step === ClientOnboardingStep.RIDERS ? 'RIDERS'
            : step === ClientOnboardingStep.TEAM_LEADERS ? 'TEAM_LEADERS' : 'GENERAL';
  }
}
