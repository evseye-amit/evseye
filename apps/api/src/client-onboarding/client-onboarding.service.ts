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

const steps = [
  ClientOnboardingStep.HUBS,
  ClientOnboardingStep.FLEET_MANAGERS,
  ClientOnboardingStep.TEAM_LEADERS,
  ClientOnboardingStep.FLEETS,
  ClientOnboardingStep.RIDERS,
  ClientOnboardingStep.REVIEW,
];
const optionalSteps = new Set([
  ClientOnboardingStep.TEAM_LEADERS,
  ClientOnboardingStep.RIDERS,
]);

@Injectable()
export class ClientOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrap(clientId: string) {
    const [client, progress] = await Promise.all([
      this.prisma.client.findUniqueOrThrow({
        where: { id: clientId },
        select: {
          id: true,
          name: true,
          companyCode: true,
          status: true,
          isActive: true,
        },
      }),
      this.progress(clientId),
    ]);
    return { client, progress, route: this.routeFor(client.status) };
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
    await this.assertDraft(clientId);
    if (
      status === ClientOnboardingStepStatus.SKIPPED &&
      !optionalSteps.has(step as 'TEAM_LEADERS' | 'RIDERS')
    ) {
      throw new BadRequestException('This onboarding step cannot be skipped.');
    }
    const progress = await this.progress(clientId);
    const now = new Date();
    const record = await this.prisma.clientOnboardingStepRecord.update({
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
    const next = this.nextStep(
      progress.steps.map((item) =>
        item.step === step ? { ...item, status } : item,
      ),
    );
    await this.prisma.clientOnboardingProgress.update({
      where: { id: progress.id },
      data: { currentStep: next },
    });
    return this.progress(clientId);
  }

  async submit(clientId: string, actorId: string) {
    await this.assertDraft(clientId);
    const [hubCount, managerCount, fleetCount] = await Promise.all([
      this.prisma.hub.count({ where: { clientId, deletedAt: null } }),
      this.prisma.user.count({
        where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true },
      }),
      this.prisma.fleet.count({ where: { clientId, deletedAt: null } }),
    ]);
    if (!hubCount || !managerCount || !fleetCount) {
      throw new BadRequestException(
        'Create at least one Hub, Fleet Manager, and Fleet before submitting.',
      );
    }
    const progress = await this.progress(clientId);
    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id: clientId },
        data: { status: ClientStatus.PENDING_APPROVAL },
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

  private async assertDraft(clientId: string) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { status: true },
    });
    if (client.status !== ClientStatus.DRAFT)
      throw new ForbiddenException(
        'Onboarding is read-only until the client is returned to draft.',
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
    if (status === ClientStatus.DRAFT) return 'ONBOARDING';
    if (status === ClientStatus.PENDING_APPROVAL) return 'WAITING';
    return status === ClientStatus.REJECTED ? 'REJECTED' : 'SUSPENDED';
  }
}
