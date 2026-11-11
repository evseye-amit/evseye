import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

type Db = Prisma.TransactionClient;
export const validPrimaryLead = (
  clientId: string,
  riderId: string,
): Prisma.TeamLeaderRiderWhereInput => ({
  clientId,
  riderId,
  isActive: true,
  isPrimary: true,
  removedAt: null,
  teamLeader: {
    clientId,
    deletedAt: null,
    user: { clientId, role: 'TEAM_LEAD', isActive: true, deletedAt: null },
  },
});
const leadSelect = {
  id: true,
  userId: true,
  employeeCode: true,
  designation: true,
  user: { select: { name: true, mobile: true } },
} as const;

export async function requireAllocationTeamLead(
  tx: Db,
  clientId: string,
  riderId: string,
) {
  // Assignment and handover serialize on the same rider. Hold the selected identity through handover.
  await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${riderId} AND "clientId" = ${clientId} FOR UPDATE`;
  await tx.$queryRaw`SELECT t.id FROM "TeamLeaderRider" t
    JOIN "TeamLeaderProfile" p ON p.id = t."teamLeaderId"
    JOIN "User" u ON u.id = p."userId"
    WHERE t."clientId" = ${clientId} AND t."riderId" = ${riderId}
      AND t."isActive" AND t."isPrimary" AND t."removedAt" IS NULL
    ORDER BY t.id FOR SHARE OF t, p, u`;
  const assignments = await tx.teamLeaderRider.findMany({
    where: validPrimaryLead(clientId, riderId),
    select: { id: true },
  });
  if (assignments.length !== 1)
    throw new ConflictException({
      code: 'ALLOCATION_TEAM_LEAD_REQUIRED',
      message:
        'Assign an active Team Lead before completing scooter allocation.',
    });
}

@Injectable()
export class AllocationTeamLeadService {
  constructor(private readonly db: PrismaService) {}

  async list(
    clientId: string,
    search: string | undefined,
    page: number,
    limit: number,
  ) {
    const text = search?.trim();
    const where: Prisma.TeamLeaderProfileWhereInput = {
      clientId,
      deletedAt: null,
      user: { clientId, role: 'TEAM_LEAD', isActive: true, deletedAt: null },
      ...(text
        ? {
            OR: [
              { employeeCode: { contains: text, mode: 'insensitive' } },
              { user: { name: { contains: text, mode: 'insensitive' } } },
              { user: { mobile: { contains: text } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.teamLeaderProfile.findMany({
        where,
        select: {
          ...leadSelect,
          _count: {
            select: {
              riders: { where: { clientId, isActive: true, removedAt: null } },
            },
          },
        },
        orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.teamLeaderProfile.count({ where }),
    ]);
    return {
      data: rows.map(({ user, _count, ...profile }) => ({
        ...profile,
        name: user.name,
        mobile: user.mobile,
        assignedRiderCount: _count.riders,
      })),
      meta: { page, limit, total },
    };
  }

  private async allocation(
    db: Db,
    clientId: string,
    userId: string,
    id: string,
  ) {
    const hubs = await db.userHub.findMany({
      where: {
        clientId,
        userId,
        hub: { clientId, status: 'ACTIVE', deletedAt: null },
      },
      select: { hubId: true },
    });
    const allocation = await db.allocation.findFirst({
      where: {
        id,
        clientId,
        fleet: { currentHubId: { in: hubs.map((h) => h.hubId) } },
        rider: { clientId, status: 'ACTIVE', deletedAt: null },
      },
    });
    if (!allocation)
      throw new NotFoundException('Allocation not found in an assigned Hub.');
    return allocation;
  }

  async get(clientId: string, userId: string, id: string) {
    const allocation = await this.allocation(this.db, clientId, userId, id);
    const rows = await this.db.teamLeaderRider.findMany({
      where: validPrimaryLead(clientId, allocation.riderId),
      select: { teamLeader: { select: leadSelect } },
    });
    const lead = rows.length === 1 ? rows[0]!.teamLeader : null;
    return {
      allocationId: id,
      riderId: allocation.riderId,
      teamLead: lead
        ? {
            id: lead.id,
            userId: lead.userId,
            employeeCode: lead.employeeCode,
            designation: lead.designation,
            ...lead.user,
          }
        : null,
    };
  }

  async assign(
    clientId: string,
    userId: string,
    id: string,
    teamLeaderId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ${id} AND "clientId" = ${clientId} FOR UPDATE`;
      const allocation = await this.allocation(tx, clientId, userId, id);
      if (
        !['INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING'].includes(
          allocation.status,
        )
      )
        throw new ConflictException(
          'Team Lead can only be changed while allocation is in progress.',
        );
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${allocation.riderId} AND "clientId" = ${clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT p.id FROM "TeamLeaderProfile" p JOIN "User" u ON u.id = p."userId" WHERE p.id = ${teamLeaderId} AND p."clientId" = ${clientId} FOR SHARE OF p, u`;
      const leader = await tx.teamLeaderProfile.findFirst({
        where: {
          id: teamLeaderId,
          clientId,
          deletedAt: null,
          user: {
            clientId,
            role: 'TEAM_LEAD',
            isActive: true,
            deletedAt: null,
          },
        },
        select: leadSelect,
      });
      if (!leader)
        throw new NotFoundException(
          'Active Team Lead not found in this client.',
        );
      const previous = await tx.teamLeaderRider.findMany({
        where: {
          clientId,
          riderId: allocation.riderId,
          isActive: true,
          isPrimary: true,
        },
        select: { teamLeaderId: true },
      });
      await tx.teamLeaderRider.updateMany({
        where: {
          clientId,
          riderId: allocation.riderId,
          isActive: true,
          isPrimary: true,
          teamLeaderId: { not: teamLeaderId },
        },
        data: { isPrimary: false },
      });
      const current = await tx.teamLeaderRider.findUnique({
        where: {
          teamLeaderId_riderId: { teamLeaderId, riderId: allocation.riderId },
        },
      });
      const unchanged =
        current?.isActive && current.isPrimary && current.removedAt === null;
      await tx.teamLeaderRider.upsert({
        where: {
          teamLeaderId_riderId: { teamLeaderId, riderId: allocation.riderId },
        },
        create: {
          clientId,
          riderId: allocation.riderId,
          teamLeaderId,
          isPrimary: true,
        },
        update: {
          isActive: true,
          isPrimary: true,
          removedAt: null,
          ...(unchanged ? {} : { assignedAt: new Date() }),
        },
      });
      if (!unchanged || previous.some((p) => p.teamLeaderId !== teamLeaderId))
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: userId,
            action: 'ALLOCATION_TEAM_LEAD_ASSIGNED',
            entityType: 'Allocation',
            entityId: id,
            newData: {
              riderId: allocation.riderId,
              teamLeaderId,
              previousTeamLeaderIds: previous.map((p) => p.teamLeaderId),
            },
          },
        });
      return {
        allocationId: id,
        riderId: allocation.riderId,
        teamLead: {
          id: leader.id,
          userId: leader.userId,
          employeeCode: leader.employeeCode,
          designation: leader.designation,
          ...leader.user,
        },
      };
    });
  }
}
