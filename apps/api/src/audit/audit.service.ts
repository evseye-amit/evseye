import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListAuditDto } from './list-audit.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    clientId: string,
    page = 1,
    pageSize = 50,
    query: Partial<ListAuditDto> = {},
  ) {
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException('Start date must not be after end date.');
    }
    const where: Prisma.AuditLogWhereInput = {
      clientId,
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
      ...(query.entityType
        ? { entityType: { contains: query.entityType, mode: 'insensitive' } }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { action: { contains: query.search, mode: 'insensitive' } },
              { entityType: { contains: query.search, mode: 'insensitive' } },
              { entityId: { contains: query.search, mode: 'insensitive' } },
              { actorId: { contains: query.search, mode: 'insensitive' } },
              {
                actor: {
                  is: {
                    clientId,
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: query.sortBy
          ? [{ [query.sortBy]: query.sortDirection ?? 'asc' }, { id: 'desc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    // Resolve labels in bounded, client-scoped queries. Keep historical IDs as fallback.
    const actorIds = [
      ...new Set(items.flatMap((item) => (item.actorId ? [item.actorId] : []))),
    ];
    const entityIds = (type: string) =>
      items
        .filter((item) => item.entityType === type && item.entityId)
        .map((item) => item.entityId!);
    const [actors, fleets, riders] = await Promise.all([
      this.prisma.user.findMany({
        where: { clientId, id: { in: actorIds } },
        select: { id: true, name: true },
      }),
      this.prisma.fleet.findMany({
        where: { clientId, id: { in: entityIds('FLEET') } },
        select: { id: true, vehicleNumber: true, fleetCode: true },
      }),
      this.prisma.rider.findMany({
        where: { clientId, id: { in: entityIds('RIDER') } },
        select: { id: true, name: true },
      }),
    ]);
    const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
    const entityNames = new Map<string, string>([
      ...fleets.map(
        (fleet) =>
          [
            `FLEET:${fleet.id}`,
            fleet.vehicleNumber ?? fleet.fleetCode,
          ] as const,
      ),
      ...riders.map((rider) => [`RIDER:${rider.id}`, rider.name] as const),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        actorName: item.actorId ? (actorNames.get(item.actorId) ?? null) : null,
        entityName:
          entityNames.get(`${item.entityType}:${item.entityId}`) ?? null,
      })),
      meta: { page, pageSize: safePageSize, total },
    };
  }

  record(input: {
    clientId?: string;
    actorId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    requestId?: string;
    ipAddress?: string;
    previousData?: object;
    newData?: object;
  }) {
    return this.prisma.auditLog.create({ data: input });
  }
}
