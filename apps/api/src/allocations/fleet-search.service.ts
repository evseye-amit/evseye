import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import type { FleetSearchQueryDto } from './fleet-search.controller.js';
const fields = {
  id: true,
  fleetCode: true,
  vehicleNumber: true,
  chassisNumber: true,
  modelName: true,
  variantName: true,
  colour: true,
  status: true,
  onboardingStatus: true,
  allocationEnabled: true,
  currentHubId: true,
  oem: { select: { id: true, name: true } },
  vehicleType: { select: { id: true, name: true } },
  currentHub: {
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      status: true,
      deletedAt: true,
    },
  },
} as const;
@Injectable()
export class FleetSearchService {
  constructor(
    private readonly db: PrismaService,
    private readonly media: MediaService,
    private readonly config: ConfigService,
  ) {}
  private async hubs(clientId: string, userId: string) {
    return (
      await this.db.userHub.findMany({
        where: {
          clientId,
          userId,
          hub: { clientId, status: 'ACTIVE', deletedAt: null },
        },
        select: { hubId: true },
      })
    ).map((h) => h.hubId);
  }
  private present(
    fleet: Prisma.FleetGetPayload<{ select: typeof fields }>,
    hubs: string[],
  ) {
    const canManage =
      !!fleet.currentHubId &&
      hubs.includes(fleet.currentHubId) &&
      fleet.currentHub?.status === 'ACTIVE' &&
      !fleet.currentHub.deletedAt;
    const { currentHubId: _hubId, currentHub, ...details } = fleet;
    return {
      ...details,
      currentHub: currentHub
        ? {
            id: currentHub.id,
            code: currentHub.code,
            name: currentHub.name,
            city: currentHub.city,
          }
        : null,
      access: {
        canManage,
        reason: canManage
          ? null
          : 'This scooter is outside your active assigned hubs.',
      },
    };
  }
  async search(clientId: string, userId: string, query: FleetSearchQueryDto) {
    const hubs = await this.hubs(clientId, userId);
    const search = query.search?.trim();
    const where: Prisma.FleetWhereInput = {
      clientId,
      deletedAt: null,
      ...(query.hubId ? { currentHubId: query.hubId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: ['fleetCode', 'vehicleNumber', 'chassisNumber'].map(
              (field) => ({
                [field]: { contains: search, mode: 'insensitive' },
              }),
            ),
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.fleet.findMany({
        where,
        select: fields,
        orderBy: [{ fleetCode: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.fleet.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.present(row, hubs)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }
  async get(clientId: string, userId: string, id: string) {
    const fleet = await this.db.fleet.findFirst({
      where: { id, clientId, deletedAt: null },
      select: fields,
    });
    if (!fleet) throw new NotFoundException('Scooter not found.');
    const hubs = await this.hubs(clientId, userId);
    const [allocation, submission, inspection] = await Promise.all([
      this.db.allocation.findFirst({
        where: {
          clientId,
          fleetId: id,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          allocatedAt: true,
          rider: { select: { id: true, riderCode: true, name: true } },
        },
      }),
      this.db.vehicleSubmission.findFirst({
        where: { clientId, fleetId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          confirmedAt: true,
          mechanicChecksComplete: true,
          hubId: true,
          returnRequestId: true,
          exchangeRequestId: true,
        },
      }),
      this.db.inspection.findFirst({
        where: {
          clientId,
          type: 'PRE_ALLOCATION',
          allocation: { clientId, fleetId: id },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    ]);
    let photo = inspection
      ? await this.db.photo.findFirst({
          where: {
            clientId,
            entityType: 'INSPECTION',
            workFlowType: 'ALLOTMENT',
            subjectType: 'INSPECTION',
            entityId: inspection.id,
            photoType: 'FRONT',
            status: 'COMPLETE',
          },
          orderBy: { uploadedAt: 'desc' },
          select: { id: true },
        })
      : null;
    photo ??= await this.db.photo.findFirst({
      where: {
        clientId,
        entityType: 'FLEET',
        workFlowType: 'FLEET_MANAGEMENT',
        subjectType: 'FLEET',
        entityId: id,
        photoType: 'FRONT',
        status: 'COMPLETE',
      },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true },
    });
    const url = photo ? await this.media.downloadUrl(clientId, photo.id) : null;
    const ttl = this.config.get<number>('S3_SIGNED_URL_TTL_SECONDS');
    return {
      ...this.present(fleet, hubs),
      allocation,
      submission,
      frontPhoto:
        photo && url
          ? {
              id: photo.id,
              url: url.url,
              expiresAt: ttl
                ? new Date(Date.now() + Number(ttl) * 1000).toISOString()
                : null,
            }
          : null,
    };
  }
}
