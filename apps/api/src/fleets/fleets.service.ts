import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  ClientStatus,
  AllocationStatus,
  FleetStatus,
  ImportEntityType,
  ImportStatus,
  Prisma,
  PhotoEntityType,
  PhotoStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateFleetDto } from './dto/create-fleet.dto.js';
import type { ListFleetsDto } from './dto/list-fleets.dto.js';
import type { UpdateFleetDto } from './dto/update-fleet.dto.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';

@Injectable()
export class FleetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusPolicy: FleetStatusPolicy,
  ) {}

  private readonly activeAllocationStatuses: AllocationStatus[] = [
    AllocationStatus.INITIATED,
    AllocationStatus.INSPECTION_PENDING,
    AllocationStatus.OTP_PENDING,
    AllocationStatus.ACTIVE,
    AllocationStatus.DEALLOCATION_INITIATED,
  ];
  private readonly defaultOnboardingPhotoRequirements = [
    PhotoEntityType.FLEET,
    PhotoEntityType.BATTERY,
    PhotoEntityType.CONTROLLER,
    PhotoEntityType.IOT_DEVICE,
  ].flatMap((entityType) => {
    const photoTypes =
      entityType === PhotoEntityType.FLEET
        ? ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'DASHBOARD']
        : entityType === PhotoEntityType.BATTERY
          ? ['FRONT', 'REAR', 'LABEL', 'SERIAL']
          : entityType === PhotoEntityType.IOT_DEVICE
            ? ['INSTALLATION', 'SERIAL_LABEL']
            : ['FRONT', 'REAR'];
    return photoTypes.map((photoType, sortOrder) => ({
      entityType,
      photoType,
      sortOrder,
      isRequired: true,
    }));
  });

  private asAllocatable(fleet: {
    status: FleetStatus;
    onboardingStatus: import('@prisma/client').FleetOnboardingStatus;
    allocationEnabled: boolean;
    _count?: { allocations: number };
  }) {
    return (
      fleet.status === FleetStatus.AVAILABLE &&
      fleet.onboardingStatus === 'ACTIVE' &&
      fleet.allocationEnabled &&
      (fleet._count?.allocations ?? 0) === 0
    );
  }

  private present<
    T extends {
      status: FleetStatus;
      onboardingStatus: import('@prisma/client').FleetOnboardingStatus;
      allocationEnabled: boolean;
      _count?: { allocations: number };
    },
  >(fleet: T) {
    const { _count, ...data } = fleet;
    return { ...data, isAllocatable: this.asAllocatable(fleet) };
  }
  async create(clientId: string, dto: CreateFleetDto) {
    const [oem, category, type, homeHub, currentHub] = await Promise.all([
      this.prisma.oem.findFirst({
        where: { id: dto.oemId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.vehicleCategory.findFirst({
        where: { id: dto.vehicleCategoryId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.vehicleType.findFirst({
        where: {
          id: dto.vehicleTypeId,
          categoryId: dto.vehicleCategoryId,
          status: 'ACTIVE',
        },
        select: { id: true },
      }),
      dto.homeHubId
        ? this.prisma.hub.findFirst({
            where: { id: dto.homeHubId, clientId, deletedAt: null },
            select: { id: true },
          })
        : null,
      dto.currentHubId
        ? this.prisma.hub.findFirst({
            where: { id: dto.currentHubId, clientId, deletedAt: null },
            select: { id: true },
          })
        : null,
    ]);
    if (!oem) throw new NotFoundException('Active OEM not found.');
    if (!category)
      throw new NotFoundException('Active vehicle category not found.');
    if (!type) {
      throw new NotFoundException(
        'Active vehicle type was not found for the selected category.',
      );
    }
    if (dto.homeHubId && !homeHub)
      throw new NotFoundException('Hub not found.');
    if (dto.currentHubId && !currentHub) {
      throw new NotFoundException('Current hub not found.');
    }
    try {
      const fleet = await this.prisma.fleet.create({
        data: {
          clientId,
          fleetCode:
            dto.fleetCode?.trim().toUpperCase() ??
            `FLT-${dto.chassisNumber.trim().toUpperCase()}`,
          vehicleNumber: dto.vehicleNumber?.trim().toUpperCase(),
          chassisNumber: dto.chassisNumber.trim().toUpperCase(),
          vinNumber: dto.vinNumber?.trim().toUpperCase(),
          oemId: dto.oemId,
          vehicleCategoryId: dto.vehicleCategoryId,
          vehicleTypeId: dto.vehicleTypeId,
          speedType: dto.speedType,
          modelName: dto.modelName?.trim(),
          variantName: dto.variantName?.trim(),
          colour: dto.colour?.trim(),
          motorNumber: dto.motorNumber?.trim(),
          manufacturingYear: dto.manufacturingYear,
          manufacturingMonth: dto.manufacturingMonth,
          ownershipType: dto.ownershipType,
          odometerKm: dto.odometerKm,
          status: dto.status ?? FleetStatus.IN_TRANSIT,
          statusHistory: {
            create: { toStatus: dto.status ?? FleetStatus.IN_TRANSIT },
          },
          registration: dto.registrationDate
            ? {
                create: {
                  registrationDate: new Date(dto.registrationDate),
                  registeringAuthority: dto.registeringAuthority,
                  rcExpiryDate: dto.rcExpiryDate
                    ? new Date(dto.rcExpiryDate)
                    : undefined,
                },
              }
            : undefined,
          insurance:
            dto.insuranceProviderName ||
            dto.insurancePolicyNumber ||
            dto.insuranceStartDate ||
            dto.insuranceEndDate
              ? {
                  create: {
                    providerName: dto.insuranceProviderName,
                    policyNumber: dto.insurancePolicyNumber,
                    insuranceType: dto.insuranceType,
                    startDate: dto.insuranceStartDate
                      ? new Date(dto.insuranceStartDate)
                      : undefined,
                    endDate: dto.insuranceEndDate
                      ? new Date(dto.insuranceEndDate)
                      : undefined,
                  },
                }
              : undefined,
          fitness:
            dto.fitnessCertificateNumber || dto.fitnessExpiryDate
              ? {
                  create: {
                    certificateNumber: dto.fitnessCertificateNumber,
                    expiryDate: dto.fitnessExpiryDate
                      ? new Date(dto.fitnessExpiryDate)
                      : undefined,
                  },
                }
              : undefined,
          currentHubId: dto.currentHubId ?? dto.homeHubId,
          homeHubId: dto.homeHubId,
        },
      });
      await this.completeOnboardingStep(clientId);
      return this.present({ ...fleet, _count: { allocations: 0 } });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Fleet code, vehicle number, chassis number, or VIN already exists in this client.',
        );
      throw error;
    }
  }
  async bulkCreate(
    clientId: string,
    actorId: string,
    filename: string,
    rows: Array<Record<string, unknown>>,
  ) {
    const [oems, categories, types, hubs] = await Promise.all([
      this.prisma.oem.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, code: true },
      }),
      this.prisma.vehicleCategory.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, code: true },
      }),
      this.prisma.vehicleType.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, code: true },
      }),
      this.prisma.hub.findMany({
        where: { clientId, deletedAt: null },
        select: { id: true, code: true },
      }),
    ]);
    const masterId = (records: Array<{ id: string; code: string }>) =>
      new Map(records.map((record) => [record.code.toUpperCase(), record.id]));
    const oemByCode = masterId(oems);
    const categoryByCode = masterId(categories);
    const typeByCode = masterId(types);
    const hubByCode = masterId(hubs);
    const failures: Array<
      Record<string, unknown> & {
        row_number: number;
        failure_reason: string;
        failure_fields: string;
      }
    > = [];
    const vehicleNumbers = new Set<string>();
    const chassisNumbers = new Set<string>();
    let created = 0;
    for (const [index, row] of rows.entries()) {
      const value = (field: string) => {
        const item = row[field];
        return typeof item === 'string' ? item.trim() : '';
      };
      const vehicleNumber = value('vehicleNumber').toUpperCase() || undefined;
      const chassisNumber = value('chassisNumber').toUpperCase();
      const code = (field: string) => value(field).toUpperCase();
      const oemId = code('oemCode')
        ? oemByCode.get(code('oemCode'))
        : value('oemId') || undefined;
      const vehicleCategoryId = code('vehicleCategoryCode')
        ? categoryByCode.get(code('vehicleCategoryCode'))
        : value('vehicleCategoryId') || undefined;
      const vehicleTypeId = code('vehicleTypeCode')
        ? typeByCode.get(code('vehicleTypeCode'))
        : value('vehicleTypeId') || undefined;
      const homeHubId = code('homeHubCode')
        ? hubByCode.get(code('homeHubCode'))
        : value('homeHubId') || undefined;
      const currentHubId = code('currentHubCode')
        ? hubByCode.get(code('currentHubCode'))
        : value('currentHubId') || homeHubId;
      const missing: string[] = [];
      if (!chassisNumber) missing.push('chassisNumber');
      if (!oemId) missing.push('oemCode');
      if (!vehicleCategoryId) missing.push('vehicleCategoryCode');
      if (!vehicleTypeId) missing.push('vehicleTypeCode');
      if (!value('speedType')) missing.push('speedType');
      if (!value('ownershipType')) missing.push('ownershipType');
      if (code('homeHubCode') && !homeHubId) missing.push('homeHubCode');
      if (code('currentHubCode') && !currentHubId)
        missing.push('currentHubCode');
      if (missing.length) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            'Missing or invalid required values: ' + missing.join(', ') + '.',
          failure_fields: missing.join(','),
        });
        continue;
      }
      if (
        (vehicleNumber && vehicleNumbers.has(vehicleNumber)) ||
        chassisNumbers.has(chassisNumber)
      ) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            'Duplicate vehicle number or chassis number in upload.',
          failure_fields: 'vehicleNumber,chassisNumber',
        });
        continue;
      }
      if (vehicleNumber) vehicleNumbers.add(vehicleNumber);
      chassisNumbers.add(chassisNumber);
      try {
        const numberValue = (field: string) => {
          const raw = value(field);
          if (!raw) return undefined;
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? parsed : undefined;
        };
        await this.create(clientId, {
          fleetCode: value('fleetCode') || undefined,
          vehicleNumber,
          chassisNumber,
          vinNumber: value('vinNumber') || undefined,
          oemId: oemId!,
          vehicleCategoryId: vehicleCategoryId!,
          vehicleTypeId: vehicleTypeId!,
          speedType: value('speedType') as CreateFleetDto['speedType'],
          homeHubId,
          currentHubId,
          modelName: value('modelName') || undefined,
          variantName: value('variantName') || undefined,
          colour: value('colour') || undefined,
          motorNumber: value('motorNumber') || undefined,
          manufacturingYear: numberValue('manufacturingYear'),
          manufacturingMonth: numberValue('manufacturingMonth'),
          ownershipType: value(
            'ownershipType',
          ) as CreateFleetDto['ownershipType'],
          odometerKm: numberValue('odometerKm'),
          registrationDate: value('registrationDate') || undefined,
          registeringAuthority: value('registeringAuthority') || undefined,
          rcExpiryDate: value('rcExpiryDate') || undefined,
          insuranceProviderName: value('insuranceProviderName') || undefined,
          insurancePolicyNumber: value('insurancePolicyNumber') || undefined,
          insuranceType: value(
            'insuranceType',
          ) as CreateFleetDto['insuranceType'],
          insuranceStartDate: value('insuranceStartDate') || undefined,
          insuranceEndDate: value('insuranceEndDate') || undefined,
          fitnessCertificateNumber:
            value('fitnessCertificateNumber') || undefined,
          fitnessExpiryDate: value('fitnessExpiryDate') || undefined,
        });
        created += 1;
      } catch (error) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            error instanceof Error ? error.message : 'Invalid row.',
          failure_fields:
            'vehicleNumber,chassisNumber,oemCode,vehicleCategoryCode,vehicleTypeCode,homeHubCode,currentHubCode',
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
        entityType: ImportEntityType.FLEET,
        status,
        originalFilename: filename,
        totalRows: rows.length,
        passedRows: created,
        failedRows: failures.length,
        duplicateRows: failures.filter((row) =>
          row.failure_reason.startsWith('Duplicate'),
        ).length,
        createdRows: created,
        createdById: actorId,
        completedAt: new Date(),
        metadata: JSON.parse(JSON.stringify({ failures })),
      },
    });
    if (created) await this.completeOnboardingStep(clientId);
    return {
      jobId: job.id,
      status,
      totalRows: rows.length,
      passedRows: created,
      failedRows: failures.length,
      createdRows: created,
    };
  }
  async failedRows(clientId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, clientId, entityType: ImportEntityType.FLEET },
      select: { metadata: true },
    });
    if (!job) throw new NotFoundException('Import job not found.');
    return (job.metadata as { failures?: unknown[] } | null)?.failures ?? [];
  }
  private async completeOnboardingStep(clientId: string) {
    const progress = await this.prisma.clientOnboardingProgress.findUnique({
      where: { clientId },
      include: { client: { select: { status: true } } },
    });
    if (
      !progress ||
      progress.client.status !== ClientStatus.CREATED ||
      progress.currentStep !== ClientOnboardingStep.FLEETS
    )
      return;
    await this.prisma.$transaction([
      this.prisma.clientOnboardingStepRecord.updateMany({
        where: { progressId: progress.id, step: ClientOnboardingStep.FLEETS },
        data: {
          status: ClientOnboardingStepStatus.COMPLETED,
          savedAt: new Date(),
          completedAt: new Date(),
        },
      }),
      this.prisma.clientOnboardingProgress.update({
        where: { id: progress.id },
        data: { currentStep: ClientOnboardingStep.RIDERS },
      }),
    ]);
  }
  async list(clientId: string, query: ListFleetsDto) {
    const where: Prisma.FleetWhereInput = {
      clientId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.onboardingStatus
        ? { onboardingStatus: query.onboardingStatus }
        : {}),
      ...(query.oemId ? { oemId: query.oemId } : {}),
      ...(query.vehicleCategoryId
        ? { vehicleCategoryId: query.vehicleCategoryId }
        : {}),
      ...(query.vehicleTypeId ? { vehicleTypeId: query.vehicleTypeId } : {}),
      ...(query.hubId
        ? {
            AND: [
              {
                OR: [{ homeHubId: query.hubId }, { currentHubId: query.hubId }],
              },
            ],
          }
        : {}),
      ...(query.isAllocatable === true
        ? {
            status: FleetStatus.AVAILABLE,
            onboardingStatus: 'ACTIVE',
            allocationEnabled: true,
            allocations: {
              none: { status: { in: this.activeAllocationStatuses } },
            },
          }
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
              {
                oem: {
                  is: {
                    OR: [
                      { code: { contains: query.search, mode: 'insensitive' } },
                      {
                        displayName: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fleet.findMany({
        where,
        include: {
          homeHub: true,
          currentHub: true,
          oem: true,
          vehicleCategory: true,
          vehicleType: true,
          _count: {
            select: {
              allocations: {
                where: { status: { in: this.activeAllocationStatuses } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.fleet.count({ where }),
    ]);
    return {
      items: items.map((fleet) => this.present(fleet)),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async onboardingOptions() {
    const [oems, vehicleCategories, vehicleTypes] = await Promise.all([
      this.prisma.oem.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, code: true, displayName: true },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.vehicleCategory.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, code: true, name: true, displayOrder: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.vehicleType.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          categoryId: true,
          code: true,
          name: true,
          energyType: true,
          usageType: true,
        },
        orderBy: [{ name: 'asc' }, { energyType: 'asc' }],
      }),
    ]);
    return { oems, vehicleCategories, vehicleTypes };
  }
  async get(clientId: string, id: string) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        homeHub: true,
        currentHub: true,
        oem: true,
        vehicleCategory: true,
        vehicleType: true,
        registration: true,
        insurance: true,
        fitness: true,
        batteryHistory: {
          where: { removedAt: null },
          include: { battery: true },
        },
        controllerHistory: {
          where: { removedAt: null },
          include: { controller: true },
        },
        iotDevice: true,
        _count: {
          select: {
            allocations: {
              where: { status: { in: this.activeAllocationStatuses } },
            },
          },
        },
      },
    });
    if (!fleet) throw new NotFoundException('Fleet not found.');
    return this.present(fleet);
  }
  async onboardingStatus(clientId: string, id: string) {
    const fleet = await this.get(clientId, id);
    await this.prisma.photoRequirement.createMany({
      data: this.defaultOnboardingPhotoRequirements.map((requirement) => ({
        ...requirement,
        clientId,
      })),
      skipDuplicates: true,
    });
    const entities = [
      {
        entityType: PhotoEntityType.FLEET,
        entityId: fleet.id,
        label: fleet.vehicleNumber,
      },
      ...fleet.batteryHistory.map(({ battery }) => ({
        entityType: PhotoEntityType.BATTERY,
        entityId: battery.id,
        label: battery.serialNumber,
      })),
      ...fleet.controllerHistory.map(({ controller }) => ({
        entityType: PhotoEntityType.CONTROLLER,
        entityId: controller.id,
        label: controller.controllerNumber,
      })),
      ...(fleet.iotDevice
        ? [
            {
              entityType: PhotoEntityType.IOT_DEVICE,
              entityId: fleet.iotDevice.id,
              label: fleet.iotDevice.deviceNumber,
            },
          ]
        : []),
    ];
    const entityTypes = [
      PhotoEntityType.FLEET,
      PhotoEntityType.BATTERY,
      PhotoEntityType.CONTROLLER,
      ...(fleet.iotDevice ? [PhotoEntityType.IOT_DEVICE] : []),
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

  private async validateReferences(
    clientId: string,
    input: Pick<
      UpdateFleetDto,
      | 'oemId'
      | 'vehicleCategoryId'
      | 'vehicleTypeId'
      | 'homeHubId'
      | 'currentHubId'
    >,
    current?: {
      oemId: string;
      vehicleCategoryId: string;
      vehicleTypeId: string;
    },
  ) {
    const oemId = input.oemId ?? current?.oemId;
    const vehicleCategoryId =
      input.vehicleCategoryId ?? current?.vehicleCategoryId;
    const vehicleTypeId = input.vehicleTypeId ?? current?.vehicleTypeId;
    if (!oemId || !vehicleCategoryId || !vehicleTypeId) {
      throw new BadRequestException(
        'OEM, vehicle category, and vehicle type are required.',
      );
    }
    const [oem, vehicleType, homeHub, currentHub] = await Promise.all([
      this.prisma.oem.findFirst({
        where: { id: oemId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.vehicleType.findFirst({
        where: {
          id: vehicleTypeId,
          categoryId: vehicleCategoryId,
          status: 'ACTIVE',
        },
        select: { id: true },
      }),
      input.homeHubId
        ? this.prisma.hub.findFirst({
            where: { id: input.homeHubId, clientId, deletedAt: null },
            select: { id: true },
          })
        : null,
      input.currentHubId
        ? this.prisma.hub.findFirst({
            where: { id: input.currentHubId, clientId, deletedAt: null },
            select: { id: true },
          })
        : null,
    ]);
    if (!oem) throw new NotFoundException('Active OEM not found.');
    if (!vehicleType) {
      throw new NotFoundException(
        'Active vehicle type was not found for the selected category.',
      );
    }
    if (input.homeHubId && !homeHub)
      throw new NotFoundException('Hub not found.');
    if (input.currentHubId && !currentHub) {
      throw new NotFoundException('Current hub not found.');
    }
  }

  async update(clientId: string, id: string, dto: UpdateFleetDto) {
    const current = await this.prisma.fleet.findFirst({
      where: { id, clientId, deletedAt: null },
      select: {
        id: true,
        oemId: true,
        vehicleCategoryId: true,
        vehicleTypeId: true,
      },
    });
    if (!current) throw new NotFoundException('Fleet not found.');
    await this.validateReferences(clientId, dto, current);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.fleet.update({
          where: { id },
          data: {
            fleetCode: dto.fleetCode?.trim().toUpperCase(),
            vehicleNumber: dto.vehicleNumber?.trim().toUpperCase(),
            chassisNumber: dto.chassisNumber?.trim().toUpperCase(),
            vinNumber: dto.vinNumber?.trim().toUpperCase(),
            oemId: dto.oemId,
            vehicleCategoryId: dto.vehicleCategoryId,
            vehicleTypeId: dto.vehicleTypeId,
            speedType: dto.speedType,
            modelName: dto.modelName?.trim(),
            variantName: dto.variantName?.trim(),
            colour: dto.colour?.trim(),
            motorNumber: dto.motorNumber?.trim(),
            manufacturingYear: dto.manufacturingYear,
            manufacturingMonth: dto.manufacturingMonth,
            ownershipType: dto.ownershipType,
            homeHubId: dto.homeHubId,
            currentHubId: dto.currentHubId,
            odometerKm: dto.odometerKm,
            allocationEnabled: dto.allocationEnabled,
          },
        });
        if (
          dto.registrationDate !== undefined ||
          dto.registeringAuthority !== undefined ||
          dto.rcExpiryDate !== undefined
        ) {
          await tx.fleetRegistration.upsert({
            where: { fleetId: id },
            create: {
              fleetId: id,
              registrationDate: dto.registrationDate
                ? new Date(dto.registrationDate)
                : undefined,
              registeringAuthority: dto.registeringAuthority,
              rcExpiryDate: dto.rcExpiryDate
                ? new Date(dto.rcExpiryDate)
                : undefined,
            },
            update: {
              registrationDate: dto.registrationDate
                ? new Date(dto.registrationDate)
                : undefined,
              registeringAuthority: dto.registeringAuthority,
              rcExpiryDate: dto.rcExpiryDate
                ? new Date(dto.rcExpiryDate)
                : undefined,
            },
          });
        }
        if (
          dto.insuranceProviderName !== undefined ||
          dto.insurancePolicyNumber !== undefined ||
          dto.insuranceType !== undefined ||
          dto.insuranceStartDate !== undefined ||
          dto.insuranceEndDate !== undefined
        ) {
          await tx.fleetInsurance.upsert({
            where: { fleetId: id },
            create: {
              fleetId: id,
              providerName: dto.insuranceProviderName,
              policyNumber: dto.insurancePolicyNumber,
              insuranceType: dto.insuranceType,
              startDate: dto.insuranceStartDate
                ? new Date(dto.insuranceStartDate)
                : undefined,
              endDate: dto.insuranceEndDate
                ? new Date(dto.insuranceEndDate)
                : undefined,
            },
            update: {
              providerName: dto.insuranceProviderName,
              policyNumber: dto.insurancePolicyNumber,
              insuranceType: dto.insuranceType,
              startDate: dto.insuranceStartDate
                ? new Date(dto.insuranceStartDate)
                : undefined,
              endDate: dto.insuranceEndDate
                ? new Date(dto.insuranceEndDate)
                : undefined,
            },
          });
        }
        if (
          dto.fitnessCertificateNumber !== undefined ||
          dto.fitnessExpiryDate !== undefined
        ) {
          await tx.fleetFitness.upsert({
            where: { fleetId: id },
            create: {
              fleetId: id,
              certificateNumber: dto.fitnessCertificateNumber,
              expiryDate: dto.fitnessExpiryDate
                ? new Date(dto.fitnessExpiryDate)
                : undefined,
            },
            update: {
              certificateNumber: dto.fitnessCertificateNumber,
              expiryDate: dto.fitnessExpiryDate
                ? new Date(dto.fitnessExpiryDate)
                : undefined,
            },
          });
        }
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Fleet code, vehicle number, chassis number, or VIN already exists in this client.',
        );
      }
      throw error;
    }
    return this.get(clientId, id);
  }

  async activate(clientId: string, id: string, actorId: string) {
    const fleet = await this.get(clientId, id);
    if (fleet.onboardingStatus === 'ACTIVE') return fleet;
    const evidence = await this.onboardingStatus(clientId, id);
    if (!evidence.ready) {
      throw new BadRequestException(
        'Complete all required operational photos before activation.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fleet.update({
        where: { id },
        data: {
          onboardingStatus: 'ACTIVE',
          onboardedAt: fleet.onboardedAt ?? new Date(),
          activatedAt: new Date(),
          status: FleetStatus.AVAILABLE,
        },
      });
      await tx.fleetStatusHistory.create({
        data: {
          fleetId: id,
          fromStatus: fleet.status,
          toStatus: FleetStatus.AVAILABLE,
          changedByUserId: actorId,
          reason: 'Fleet onboarding activated.',
        },
      });
      return this.present({ ...updated, _count: { allocations: 0 } });
    });
  }

  async remove(clientId: string, id: string) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        _count: {
          select: {
            allocations: {
              where: { status: { in: this.activeAllocationStatuses } },
            },
          },
        },
      },
    });
    if (!fleet) throw new NotFoundException('Fleet not found.');
    if (fleet._count.allocations > 0) {
      throw new ConflictException(
        'An active allocation prevents fleet deletion.',
      );
    }
    await this.prisma.fleet.update({
      where: { id },
      data: { deletedAt: new Date(), allocationEnabled: false },
    });
  }
  async changeStatus(
    clientId: string,
    id: string,
    status: Parameters<FleetStatusPolicy['assertTransition']>[1],
    actorId?: string,
    reason?: string,
  ) {
    const fleet = await this.get(clientId, id);
    this.statusPolicy.assertTransition(fleet.status, status);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fleet.update({
        where: { id },
        data: { status },
      });
      await tx.fleetStatusHistory.create({
        data: {
          fleetId: id,
          fromStatus: fleet.status,
          toStatus: status,
          changedByUserId: actorId,
          reason,
        },
      });
      const activeAllocationCount = await tx.allocation.count({
        where: {
          clientId,
          fleetId: id,
          status: { in: this.activeAllocationStatuses },
        },
      });
      return this.present({
        ...updated,
        _count: { allocations: activeAllocationCount },
      });
    });
  }
}
