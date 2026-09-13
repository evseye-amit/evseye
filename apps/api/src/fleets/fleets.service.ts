import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PhotoEntityType, PhotoStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateFleetDto } from './dto/create-fleet.dto.js';
import type { ListFleetsDto } from './dto/list-fleets.dto.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';

@Injectable()
export class FleetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusPolicy: FleetStatusPolicy,
  ) {}
  async create(clientId: string, dto: CreateFleetDto) {
    if (
      dto.hubId &&
      !(await this.prisma.hub.findFirst({ where: { id: dto.hubId, clientId } }))
    )
      throw new NotFoundException('Hub not found.');
    try {
      return await this.prisma.fleet.create({
        data: {
          ...dto,
          clientId,
          registrationDate: dto.registrationDate
            ? new Date(dto.registrationDate)
            : undefined,
          insuranceStartDate: dto.insuranceStartDate
            ? new Date(dto.insuranceStartDate)
            : undefined,
          insuranceEndDate: dto.insuranceEndDate
            ? new Date(dto.insuranceEndDate)
            : undefined,
          fitnessRenewalDate: dto.fitnessRenewalDate
            ? new Date(dto.fitnessRenewalDate)
            : undefined,
        },
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Vehicle number or chassis number already exists in this client.',
        );
      throw error;
    }
  }
  async list(clientId: string, query: ListFleetsDto) {
    const where = {
      clientId,
      deletedAt: null,
      ...(query.status
        ? { status: query.status as import('@prisma/client').FleetStatus }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                vehicleNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                chassisNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              { oem: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fleet.findMany({
        where,
        include: { hub: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.fleet.count({ where }),
    ]);
    return {
      items,
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async get(clientId: string, id: string) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id, clientId, deletedAt: null },
      include: { hub: true, batteries: true, controllers: true },
    });
    if (!fleet) throw new NotFoundException('Fleet not found.');
    return fleet;
  }
  async onboardingStatus(clientId: string, id: string) {
    const fleet = await this.get(clientId, id);
    const entities = [
      {
        entityType: PhotoEntityType.FLEET,
        entityId: fleet.id,
        label: fleet.vehicleNumber,
      },
      ...fleet.batteries.map((battery) => ({
        entityType: PhotoEntityType.BATTERY,
        entityId: battery.id,
        label: battery.serialNumber,
      })),
      ...fleet.controllers.map((controller) => ({
        entityType: PhotoEntityType.CONTROLLER,
        entityId: controller.id,
        label: controller.serialNumber,
      })),
    ];
    const entityTypes = [
      PhotoEntityType.FLEET,
      PhotoEntityType.BATTERY,
      PhotoEntityType.CONTROLLER,
    ];
    const [requirements, completedPhotos] = await Promise.all([
      this.prisma.photoRequirement.findMany({
        where: { clientId, entityType: { in: entityTypes }, isRequired: true },
        select: { entityType: true, photoType: true },
      }),
      this.prisma.photo.findMany({
        where: {
          clientId,
          entityType: { in: entityTypes },
          entityId: { in: entities.map((entity) => entity.entityId) },
          status: PhotoStatus.COMPLETE,
        },
        select: { entityType: true, entityId: true, photoType: true },
      }),
    ]);
    const items = entities.map((entity) => {
      const requiredPhotoTypes = requirements
        .filter((requirement) => requirement.entityType === entity.entityType)
        .map((requirement) => requirement.photoType);
      const completedPhotoTypes = completedPhotos
        .filter(
          (photo) =>
            photo.entityType === entity.entityType &&
            photo.entityId === entity.entityId,
        )
        .map((photo) => photo.photoType);
      const completed = new Set(completedPhotoTypes);
      const missingPhotoTypes = requiredPhotoTypes.filter(
        (photoType) => !completed.has(photoType),
      );
      return {
        ...entity,
        requiredPhotoTypes,
        completedPhotoTypes,
        missingPhotoTypes,
        ready: missingPhotoTypes.length === 0,
      };
    });
    return { ready: items.every((item) => item.ready), items };
  }
  async currentState(clientId: string, id: string) {
    await this.get(clientId, id);
    return this.prisma.vehicleCurrentState.findFirst({
      where: { clientId, fleetId: id },
    });
  }
  async changeStatus(
    clientId: string,
    id: string,
    status: Parameters<FleetStatusPolicy['assertTransition']>[1],
  ) {
    const fleet = await this.get(clientId, id);
    this.statusPolicy.assertTransition(fleet.status, status);
    return this.prisma.fleet.update({ where: { id }, data: { status } });
  }
}
