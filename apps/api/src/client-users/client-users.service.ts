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
import { assertUserMobileAvailable, normalizeIndianMobile, USER_MOBILE_CONFLICT_MESSAGE } from '../common/phone.js';
import type {
  AssignTeamLeaderRidersDto,
  CreateFleetManagerDto,
  CreateTeamLeaderDto,
} from './dto/create-client-user.dto.js';

@Injectable()
export class ClientUsersService {
  constructor(private readonly prisma: PrismaService) {}
  listImportHistory(clientId: string, entityType: ImportEntityType) {
    return this.prisma.importJob.findMany({
      where: { clientId, entityType },
      select: { id: true, originalFilename: true, status: true, totalRows: true, passedRows: true, failedRows: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  listFleetManagers(clientId: string) {
    return this.prisma.user.findMany({
      where: { clientId, role: UserRole.FLEET_MANAGER, deletedAt: null },
      include: { hubAssignments: { include: { hub: true } } },
      orderBy: { name: 'asc' },
    });
  }
  async createFleetManager(clientId: string, dto: CreateFleetManagerDto) {
    await this.assertHubs(clientId, dto.hubIds, dto.primaryHubId);
    await assertUserMobileAvailable(this.prisma, clientId, dto.mobile);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clientId,
            name: dto.name,
            mobile: normalizeIndianMobile(dto.mobile),
            role: UserRole.FLEET_MANAGER,
            isActive: dto.isActive ?? true,
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
          USER_MOBILE_CONFLICT_MESSAGE,
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
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Fleet Manager not found.');
    await assertUserMobileAvailable(this.prisma, clientId, dto.mobile, userId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: { name: dto.name.trim(), mobile: normalizeIndianMobile(dto.mobile), isActive: dto.isActive ?? true },
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
          USER_MOBILE_CONFLICT_MESSAGE,
        );
      throw error;
    }
  }
  async deleteFleetManager(clientId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clientId, role: UserRole.FLEET_MANAGER, deletedAt: null }, select: { id: true },
    });
    if (!user) throw new NotFoundException('Fleet Manager not found.');
    await this.prisma.$transaction([
      this.prisma.userHub.deleteMany({ where: { userId, clientId } }),
      this.prisma.user.update({ where: { id: userId }, data: { isActive: false, deletedAt: new Date() } }),
    ]);
    return { deleted: true };
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
      const canonicalMobile = normalizeIndianMobile(row.mobile);
      if (seen.has(canonicalMobile)) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason: 'Duplicate mobile in upload.',
          failure_fields: 'mobile',
        });
        continue;
      }
      seen.add(canonicalMobile);
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
    await assertUserMobileAvailable(this.prisma, clientId, dto.mobile);
    try {
      const profile = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clientId,
            name: dto.name,
            mobile: normalizeIndianMobile(dto.mobile),
            role: UserRole.TEAM_LEAD,
            isActive: dto.isActive ?? true,
          },
        });
        return tx.teamLeaderProfile.create({
          data: {
            clientId,
            userId: user.id,
            employeeCode: dto.employeeCode,
            designation: dto.designation,
            joiningDate: dto.joiningDate ? new Date(`${dto.joiningDate}T00:00:00.000Z`) : null,
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
          'This mobile number is already assigned to another user or role, or the employee code is already used.',
        );
      throw error;
    }
  }
  listTeamLeaders(clientId: string) {
    return this.prisma.teamLeaderProfile.findMany({
      where: { clientId, deletedAt: null },
      include: { user: true, _count: { select: { riders: { where: { isActive: true } } } } },
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
    await assertUserMobileAvailable(this.prisma, clientId, dto.mobile, profile.userId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.isActive === false) {
          const assigned = await tx.teamLeaderRider.count({
            where: { clientId, teamLeaderId: profileId, isActive: true },
          });
          if (assigned) throw new ConflictException('Reassign this Team Leader’s riders before deactivating the account.');
        }
        await tx.user.update({
          where: { id: profile.userId },
          data: { name: dto.name.trim(), mobile: normalizeIndianMobile(dto.mobile), isActive: dto.isActive ?? true },
        });
        return tx.teamLeaderProfile.update({
          where: { id: profileId },
          data: {
            employeeCode: dto.employeeCode?.trim() || null,
            designation: dto.designation?.trim() || null,
            joiningDate: dto.joiningDate ? new Date(`${dto.joiningDate}T00:00:00.000Z`) : null,
          },
        });
      });
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'This mobile number is already assigned to another user or role, or the employee code is already used.',
        );
      throw error;
    }
  }
  async reassignTeamLeader(clientId: string, profileId: string, targetTeamLeaderId?: string) {
    if (targetTeamLeaderId === profileId)
      throw new ConflictException('Choose a different Team Leader for reassignment.');
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.teamLeaderProfile.findFirst({
        where: { id: profileId, clientId, deletedAt: null, user: { isActive: true, deletedAt: null } },
        select: { userId: true },
      });
      if (!source) throw new NotFoundException('Active Team Leader not found.');
      const assignments = await tx.teamLeaderRider.findMany({
        where: { clientId, teamLeaderId: profileId, isActive: true },
        select: { riderId: true, isPrimary: true },
      });
      if (assignments.length && !targetTeamLeaderId)
        throw new ConflictException('Select an active Team Leader to receive these riders.');
      if (targetTeamLeaderId) {
        const target = await tx.teamLeaderProfile.findFirst({
          where: { id: targetTeamLeaderId, clientId, deletedAt: null, user: { isActive: true, deletedAt: null } },
          select: { id: true },
        });
        if (!target) throw new NotFoundException('Receiving Team Leader is not active or is outside this client.');
        for (const assignment of assignments) {
          const existing = await tx.teamLeaderRider.findUnique({
            where: { teamLeaderId_riderId: { teamLeaderId: target.id, riderId: assignment.riderId } },
            select: { isActive: true, isPrimary: true },
          });
          if (assignment.isPrimary) {
            await tx.teamLeaderRider.updateMany({
              where: { clientId, riderId: assignment.riderId, isActive: true, isPrimary: true },
              data: { isPrimary: false },
            });
          }
          await tx.teamLeaderRider.upsert({
            where: { teamLeaderId_riderId: { teamLeaderId: target.id, riderId: assignment.riderId } },
            create: { clientId, teamLeaderId: target.id, riderId: assignment.riderId, isPrimary: assignment.isPrimary },
            update: { isActive: true, isPrimary: assignment.isPrimary || (existing?.isActive && existing.isPrimary) || false, assignedAt: new Date(), removedAt: null },
          });
        }
      }
      const removedAt = new Date();
      await tx.teamLeaderRider.updateMany({
        where: { clientId, teamLeaderId: profileId, isActive: true },
        data: { isActive: false, isPrimary: false, removedAt },
      });
      const deactivated = await tx.user.updateMany({
        where: { id: source.userId, isActive: true, deletedAt: null },
        data: { isActive: false },
      });
      if (deactivated.count !== 1)
        throw new ConflictException('This Team Leader has already been deactivated. Refresh the table.');
      return { reassigned: assignments.length, deactivated: true };
    });
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
      const canonicalMobile = normalizeIndianMobile(row.mobile);
      if (seen.has(canonicalMobile)) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason: 'Duplicate mobile in upload.',
          failure_fields: 'mobile',
        });
        continue;
      }
      seen.add(canonicalMobile);
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
    const riderCount = await this.prisma.rider.count({
      where: { id: { in: dto.riderIds }, clientId, deletedAt: null },
    });
    if (riderCount !== new Set(dto.riderIds).size)
      throw new NotFoundException(
        'One or more Riders do not belong to this client.',
      );
    return this.prisma.$transaction(async (tx) => {
      const leader = await tx.teamLeaderProfile.findFirst({
        where: { id: teamLeaderId, clientId, deletedAt: null, user: { isActive: true, deletedAt: null } },
      });
      if (!leader) throw new NotFoundException('Active Team Leader not found.');
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
