import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  ClientStatus,
  ImportEntityType,
  ImportStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeIndianMobile } from '../common/phone.js';
import type {
  AssignTeamLeaderRidersDto,
  CreateFleetManagerDto,
  CreateTeamLeaderDto,
} from './dto/create-client-user.dto.js';

@Injectable()
export class ClientUsersService {
  constructor(private readonly prisma: PrismaService) {}
  listFleetManagers(clientId: string) {
    return this.prisma.user.findMany({
      where: { clientId, role: UserRole.FLEET_MANAGER, isActive: true },
      include: { hubAssignments: { include: { hub: true } } },
      orderBy: { name: 'asc' },
    });
  }
  async createFleetManager(clientId: string, dto: CreateFleetManagerDto) {
    await this.assertHubs(clientId, dto.hubIds, dto.primaryHubId);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clientId,
            name: dto.name,
            mobile: normalizeIndianMobile(dto.mobile),
            role: UserRole.FLEET_MANAGER,
          },
        });
        await tx.userHub.createMany({
          data: dto.hubIds.map((hubId) => ({
            clientId,
            userId: user.id,
            hubId,
            isPrimary: hubId === dto.primaryHubId,
          })),
        });
        return user;
      });
      await this.completeStep(
        clientId,
        ClientOnboardingStep.FLEET_MANAGERS,
        ClientOnboardingStep.TEAM_LEADERS,
      );
      return user;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'A user with this mobile number already exists in this client.',
        );
      throw error;
    }
  }
  async updateFleetManager(
    clientId: string,
    userId: string,
    dto: CreateFleetManagerDto,
  ) {
    await this.assertHubs(clientId, dto.hubIds, dto.primaryHubId);
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        clientId,
        role: UserRole.FLEET_MANAGER,
        isActive: true,
      },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Fleet Manager not found.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: { name: dto.name.trim(), mobile: normalizeIndianMobile(dto.mobile) },
        });
        await tx.userHub.deleteMany({ where: { userId, clientId } });
        await tx.userHub.createMany({
          data: dto.hubIds.map((hubId) => ({
            clientId,
            userId,
            hubId,
            isPrimary: hubId === dto.primaryHubId,
          })),
        });
        return updated;
      });
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'A user with this mobile number already exists in this client.',
        );
      throw error;
    }
  }
  async bulkCreateFleetManagers(
    clientId: string,
    actorId: string,
    filename: string,
    rows: CreateFleetManagerDto[],
  ) {
    const failures: Array<
      CreateFleetManagerDto & {
        row_number: number;
        failure_reason: string;
        failure_fields: string;
      }
    > = [];
    const seen = new Set<string>();
    let created = 0;
    for (const [index, row] of rows.entries()) {
      if (seen.has(row.mobile)) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason: 'Duplicate mobile in upload.',
          failure_fields: 'mobile',
        });
        continue;
      }
      seen.add(row.mobile);
      try {
        await this.createFleetManager(clientId, row);
        created += 1;
      } catch (error) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            error instanceof Error ? error.message : 'Invalid row.',
          failure_fields: 'mobile,hubIds',
        });
      }
    }
    const status = !created
      ? ImportStatus.FAIL
      : failures.length
        ? ImportStatus.PARTIAL_PASS
        : ImportStatus.PASS;
    const job = await this.prisma.importJob.create({
      data: {
        clientId,
        entityType: ImportEntityType.FLEET_MANAGER,
        status,
        originalFilename: filename,
        totalRows: rows.length,
        passedRows: created,
        failedRows: failures.length,
        duplicateRows: failures.filter((row) => row.failure_fields === 'mobile')
          .length,
        createdRows: created,
        createdById: actorId,
        completedAt: new Date(),
        metadata: JSON.parse(JSON.stringify({ failures })),
      },
    });
    return {
      jobId: job.id,
      status,
      totalRows: rows.length,
      passedRows: created,
      failedRows: failures.length,
      createdRows: created,
    };
  }
  async failedRows(
    clientId: string,
    jobId: string,
    entityType: ImportEntityType,
  ) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, clientId, entityType },
      select: { metadata: true },
    });
    if (!job) throw new NotFoundException('Import job not found.');
    return (job.metadata as { failures?: unknown[] } | null)?.failures ?? [];
  }
  async createTeamLeader(clientId: string, dto: CreateTeamLeaderDto) {
    try {
      const profile = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clientId,
            name: dto.name,
            mobile: normalizeIndianMobile(dto.mobile),
            role: UserRole.TEAM_LEAD,
          },
        });
        return tx.teamLeaderProfile.create({
          data: {
            clientId,
            userId: user.id,
            employeeCode: dto.employeeCode,
            designation: dto.designation,
          },
        });
      });
      await this.completeStep(
        clientId,
        ClientOnboardingStep.TEAM_LEADERS,
        ClientOnboardingStep.FLEETS,
      );
      return profile;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'A Team Leader with this mobile or employee code already exists in this client.',
        );
      throw error;
    }
  }
  listTeamLeaders(clientId: string) {
    return this.prisma.teamLeaderProfile.findMany({
      where: { clientId, deletedAt: null },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async updateTeamLeader(
    clientId: string,
    profileId: string,
    dto: CreateTeamLeaderDto,
  ) {
    const profile = await this.prisma.teamLeaderProfile.findFirst({
      where: { id: profileId, clientId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!profile) throw new NotFoundException('Team Leader not found.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: profile.userId },
          data: { name: dto.name.trim(), mobile: normalizeIndianMobile(dto.mobile) },
        });
        return tx.teamLeaderProfile.update({
          where: { id: profileId },
          data: {
            employeeCode: dto.employeeCode?.trim() || null,
            designation: dto.designation?.trim() || null,
          },
        });
      });
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'A Team Leader with this mobile or employee code already exists in this client.',
        );
      throw error;
    }
  }
  async bulkCreateTeamLeaders(
    clientId: string,
    actorId: string,
    filename: string,
    rows: CreateTeamLeaderDto[],
  ) {
    const failures: Array<
      CreateTeamLeaderDto & {
        row_number: number;
        failure_reason: string;
        failure_fields: string;
      }
    > = [];
    const seen = new Set<string>();
    let created = 0;
    for (const [index, row] of rows.entries()) {
      if (seen.has(row.mobile)) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason: 'Duplicate mobile in upload.',
          failure_fields: 'mobile',
        });
        continue;
      }
      seen.add(row.mobile);
      try {
        await this.createTeamLeader(clientId, row);
        created += 1;
      } catch (error) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            error instanceof Error ? error.message : 'Invalid row.',
          failure_fields: 'mobile,employeeCode',
        });
      }
    }
    const status = !created
      ? ImportStatus.FAIL
      : failures.length
        ? ImportStatus.PARTIAL_PASS
        : ImportStatus.PASS;
    const job = await this.prisma.importJob.create({
      data: {
        clientId,
        entityType: ImportEntityType.TEAM_LEADER,
        status,
        originalFilename: filename,
        totalRows: rows.length,
        passedRows: created,
        failedRows: failures.length,
        duplicateRows: failures.filter((row) => row.failure_fields === 'mobile')
          .length,
        createdRows: created,
        createdById: actorId,
        completedAt: new Date(),
        metadata: JSON.parse(JSON.stringify({ failures })),
      },
    });
    return {
      jobId: job.id,
      status,
      totalRows: rows.length,
      passedRows: created,
      failedRows: failures.length,
      createdRows: created,
    };
  }
  async assignRiders(
    clientId: string,
    teamLeaderId: string,
    dto: AssignTeamLeaderRidersDto,
  ) {
    const leader = await this.prisma.teamLeaderProfile.findFirst({
      where: { id: teamLeaderId, clientId, deletedAt: null },
    });
    if (!leader) throw new NotFoundException('Team Leader not found.');
    const riderCount = await this.prisma.rider.count({
      where: { id: { in: dto.riderIds }, clientId, deletedAt: null },
    });
    if (riderCount !== new Set(dto.riderIds).size)
      throw new NotFoundException(
        'One or more Riders do not belong to this client.',
      );
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary !== false)
        await tx.teamLeaderRider.updateMany({
          where: {
            clientId,
            riderId: { in: dto.riderIds },
            isPrimary: true,
            isActive: true,
          },
          data: { isPrimary: false },
        });
      for (const riderId of dto.riderIds)
        await tx.teamLeaderRider.upsert({
          where: { teamLeaderId_riderId: { teamLeaderId, riderId } },
          create: {
            clientId,
            teamLeaderId,
            riderId,
            isPrimary: dto.isPrimary !== false,
          },
          update: {
            isActive: true,
            isPrimary: dto.isPrimary !== false,
            removedAt: null,
          },
        });
      return { assigned: dto.riderIds.length };
    });
  }
  private async assertHubs(
    clientId: string,
    hubIds: string[],
    primaryHubId: string,
  ) {
    if (!hubIds.length || !hubIds.includes(primaryHubId))
      throw new NotFoundException('Select at least one Hub and a primary Hub.');
    const count = await this.prisma.hub.count({
      where: { clientId, id: { in: hubIds }, deletedAt: null },
    });
    if (count !== new Set(hubIds).size)
      throw new NotFoundException(
        'One or more Hubs do not belong to this client.',
      );
  }
  private async completeStep(
    clientId: string,
    step: ClientOnboardingStep,
    nextStep: ClientOnboardingStep,
  ) {
    const progress = await this.prisma.clientOnboardingProgress.findUnique({
      where: { clientId },
      include: { client: { select: { status: true } } },
    });
    if (
      !progress ||
      progress.client.status !== ClientStatus.CREATED ||
      progress.currentStep !== step
    )
      return;
    await this.prisma.$transaction([
      this.prisma.clientOnboardingStepRecord.updateMany({
        where: { progressId: progress.id, step },
        data: {
          status: ClientOnboardingStepStatus.COMPLETED,
          savedAt: new Date(),
          completedAt: new Date(),
        },
      }),
      this.prisma.clientOnboardingProgress.update({
        where: { id: progress.id },
        data: { currentStep: nextStep },
      }),
    ]);
  }
  private unique(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
