import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  ClientStatus,
  AllocationStatus,
  FleetStatus,
  FleetOperatingMode,
  FleetTransferStatus,
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
import {
  policySchema,
  stagePlans,
  vehicleReadiness,
} from '../fleet-readiness/readiness-policy.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';

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
    const record = fleet as T & {
      readinessWorkflow?: FleetOperatingMode;
      readinessStagePlanCode?: string | null;
      preparations?: Array<{
        id: string;
        status: string;
        stages?: Array<{ status: string }>;
      }>;
      transfers?: Array<{
        id: string;
        status: string;
        fromHubId: string | null;
        toHubId: string;
        initiatedAt: Date;
      }>;
    };
    const { _count, preparations, transfers, ...data } = record;
    const preparation = preparations?.[0];
    const stages = preparation?.stages ?? [];
    return {
      ...data,
      readinessSummary: {
        workflow: record.readinessWorkflow,
        stagePlanCode: record.readinessStagePlanCode ?? null,
        preparationStatus: preparation?.status ?? null,
        stageProgress: stages.length
          ? {
              completed: stages.filter((stage) => stage.status === 'COMPLETED')
                .length,
              total: stages.length,
            }
          : null,
      },
      activeTransfer: transfers?.[0] ?? null,
      isAllocatable: this.asAllocatable(fleet),
    };
  }
  async create(clientId: string, dto: CreateFleetDto) {
    if (dto.status === FleetStatus.IN_TRANSIT) {
      throw new ConflictException(
        'Fleet transfers start after creation; a fleet cannot be created in transit.',
      );
    }
    const configuredWorkflow = dto.readinessWorkflow;
    if (configuredWorkflow === FleetOperatingMode.ONBOARDING_EVIDENCE) {
      throw new BadRequestException(
        'ONBOARDING_EVIDENCE is no longer a supported fleet workflow.',
      );
    }
    const defaultWorkflow = this.prisma.client
      ? (
          await this.prisma.client.findUnique({
            where: { id: clientId },
            select: { fleetOperatingMode: true },
          })
        )?.fleetOperatingMode
      : undefined;
    const readinessWorkflow =
      configuredWorkflow ??
      (defaultWorkflow === FleetOperatingMode.ONBOARDING_EVIDENCE
        ? FleetOperatingMode.SIMPLE
        : defaultWorkflow ?? FleetOperatingMode.SIMPLE);
    if (
      dto.readinessStagePlanCode &&
      readinessWorkflow !== FleetOperatingMode.STAGED_PREPARATION_QC
    )
      throw new BadRequestException(
        'A stage plan is only valid for staged preparation.',
      );
    if (dto.readinessStagePlanCode && this.prisma.fleetReadinessPolicy) {
      const policy = await this.prisma.fleetReadinessPolicy.findFirst({
        where: { clientId },
        orderBy: { version: 'desc' },
        select: { configuration: true },
      });
      const configuration = policy
        ? policySchema.safeParse(policy.configuration)
        : null;
      if (
        !configuration?.success ||
        !stagePlans(configuration.data).some(
          (plan) => plan.code === dto.readinessStagePlanCode,
        )
      )
        throw new BadRequestException('Select a configured stage plan.');
    }
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
          // Creation never represents a hub transfer. Transfers are explicit
          // and begin only after a fleet is available.
          status: FleetStatus.PENDING_ACTIVATION,
          readinessWorkflow,
          readinessStagePlanCode: dto.readinessStagePlanCode,
          statusHistory: {
            create: { toStatus: FleetStatus.PENDING_ACTIVATION },
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
              { fleetCode: { contains: query.search, mode: 'insensitive' } },
              { modelName: { contains: query.search, mode: 'insensitive' } },
              { currentHub: { is: { name: { contains: query.search, mode: 'insensitive' } } } },
              { homeHub: { is: { name: { contains: query.search, mode: 'insensitive' } } } },
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
    const [items, total, client] = await this.prisma.$transaction([
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
          preparations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              stages: { select: { status: true } },
            },
          },
          transfers: {
            where: { status: { in: ['INITIATED', 'IN_TRANSIT'] } },
            orderBy: { initiatedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              fromHubId: true,
              toHubId: true,
              initiatedAt: true,
            },
          },
        },
        orderBy: query.sortBy
          ? [{ [query.sortBy]: query.sortDirection ?? 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.fleet.count({ where }),
      this.prisma.client.findUniqueOrThrow({
        where: { id: clientId },
        select: {
          fleetOperatingMode: true,
          readinessPolicies: {
            orderBy: { version: 'desc' },
            take: 1,
            select: { configuration: true },
          },
        },
      }),
    ]);
    const configuration = policySchema.safeParse(
      client.readinessPolicies?.[0]?.configuration,
    );
    const configuredStagePlans = configuration.success
      ? stagePlans(configuration.data)
      : [];
    return {
      items: items.map((fleet) => ({
        ...this.present(fleet),
        vehicleReadiness: vehicleReadiness({
          operatingMode:
            fleet.readinessWorkflow === 'ONBOARDING_EVIDENCE'
              ? 'SIMPLE'
              : (fleet.readinessWorkflow ?? client.fleetOperatingMode),
          status: fleet.status,
          allocationEnabled: fleet.allocationEnabled,
          onboardingStatus: fleet.onboardingStatus,
          readinessApprovedPreparationId:
            fleet.readinessApprovedPreparationId,
          unfinishedAllocationCount: fleet._count?.allocations ?? 0,
          stagePlanSelected:
            fleet.readinessWorkflow !== 'STAGED_PREPARATION_QC' ||
            configuredStagePlans.some(
              ({ code }) => code === fleet.readinessStagePlanCode,
            ),
        }),
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async onboardingOptions(clientId?: string) {
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
    const client = clientId && this.prisma.client
      ? await this.prisma.client.findUnique({
          where: { id: clientId },
          select: { fleetOperatingMode: true },
        })
      : null;
    const policy = clientId && this.prisma.fleetReadinessPolicy
      ? await this.prisma.fleetReadinessPolicy.findFirst({
          where: { clientId },
          orderBy: { version: 'desc' },
          select: { configuration: true },
        })
      : null;
    const configuration = policy
      ? policySchema.safeParse(policy.configuration)
      : null;
    const plans = configuration?.success ? stagePlans(configuration.data) : [];
    const defaultStagePlanCode = configuration?.success
      ? configuration.data.defaultStagePlanCode ?? null
      : null;
    const defaultWorkflow =
      client?.fleetOperatingMode === FleetOperatingMode.ONBOARDING_EVIDENCE
        ? FleetOperatingMode.SIMPLE
        : client?.fleetOperatingMode ?? FleetOperatingMode.SIMPLE;
    return {
      oems,
      vehicleCategories,
      vehicleTypes,
      readinessDefaultWorkflow: defaultWorkflow,
      allowedReadinessWorkflows: [
        FleetOperatingMode.SIMPLE,
        FleetOperatingMode.PREPARATION_QC,
        FleetOperatingMode.STAGED_PREPARATION_QC,
      ],
      readinessStagePlans: plans,
      readinessDefaultStagePlanCode: defaultStagePlanCode,
      // Keep the short name for clients that already consume policy plans.
      stagePlans: plans,
    };
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
        preparations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            stages: { select: { status: true } },
          },
        },
        transfers: {
          where: { status: { in: ['INITIATED', 'IN_TRANSIT'] } },
          orderBy: { initiatedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            fromHubId: true,
            toHubId: true,
            initiatedAt: true,
          },
        },
      },
    });
    if (!fleet) throw new NotFoundException('Fleet not found.');
    return this.present(fleet);
  }
  async onboardingStatus(clientId: string, id: string) {
    const fleet = await this.get(clientId, id);
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { fleetOperatingMode: true },
    });
    const readinessWorkflow =
      fleet.readinessWorkflow ??
      (client.fleetOperatingMode === FleetOperatingMode.ONBOARDING_EVIDENCE
        ? FleetOperatingMode.SIMPLE
        : client.fleetOperatingMode);
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
    return {
      operatingMode: readinessWorkflow,
      readinessWorkflow,
      // Retain the historical photo projection for authorized readers, but it
      // is no longer an activation or allocation requirement.
      photosRequired: false,
      evidenceComplete: items.every((item) => item.ready),
      ready: ([
        FleetOperatingMode.PREPARATION_QC,
        FleetOperatingMode.STAGED_PREPARATION_QC,
      ] as FleetOperatingMode[]).includes(readinessWorkflow)
        ? Boolean(fleet.readinessApprovedPreparationId)
        : true,
      items,
    };
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
        status: true,
        oemId: true,
        vehicleCategoryId: true,
        vehicleTypeId: true,
      },
    });
    if (!current) throw new NotFoundException('Fleet not found.');
    if (dto.allocationEnabled && ['MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'].includes(current.status))
      throw new ConflictException('Finish maintenance and readiness before enabling allocation.');
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
            allocationBlockedByAdmin: dto.allocationEnabled === undefined ? undefined : !dto.allocationEnabled,
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
    if (fleet.status === FleetStatus.IN_TRANSIT) {
      throw new ConflictException('Receive the fleet before activation.');
    }
    const evidence = await this.onboardingStatus(clientId, id);
    const savedWorkflow = fleet.readinessWorkflow ?? evidence.readinessWorkflow;
    const preparationWorkflow = ([
      FleetOperatingMode.PREPARATION_QC,
      FleetOperatingMode.STAGED_PREPARATION_QC,
    ] as FleetOperatingMode[]).includes(savedWorkflow);
    if (
      fleet.onboardingStatus === 'ACTIVE' &&
      fleet.status !== FleetStatus.PENDING_ACTIVATION &&
      !(preparationWorkflow && fleet.status === FleetStatus.INSPECTION_PENDING)
    )
      return fleet;
    if (
      fleet.status !== FleetStatus.PENDING_ACTIVATION &&
      !(preparationWorkflow && fleet.status === FleetStatus.INSPECTION_PENDING)
    ) {
      throw new ConflictException('Only an unallocated fleet awaiting activation can be activated.');
    }
    if (
      ([
        FleetOperatingMode.PREPARATION_QC,
        FleetOperatingMode.STAGED_PREPARATION_QC,
      ] as FleetOperatingMode[]).includes(evidence.readinessWorkflow) &&
      !fleet.readinessApprovedPreparationId
    ) {
      throw new ConflictException(
        'Complete preparation and quality check before activation.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Fleet" WHERE "id" = ${id} AND "clientId" = ${clientId} FOR UPDATE`;
      const current = await tx.fleet.findFirstOrThrow({ where: { id, clientId, deletedAt: null } });
      if (current.status === FleetStatus.IN_TRANSIT) {
        throw new ConflictException('Receive the fleet before activation.');
      }
      if (
        current.onboardingStatus === 'ACTIVE' &&
        current.status !== FleetStatus.PENDING_ACTIVATION &&
        !(preparationWorkflow && current.status === FleetStatus.INSPECTION_PENDING)
      )
        return current;
      const currentWorkflow =
        current.readinessWorkflow === FleetOperatingMode.ONBOARDING_EVIDENCE
          ? FleetOperatingMode.SIMPLE
          : current.readinessWorkflow ?? savedWorkflow;
      const currentPreparationWorkflow = ([
        FleetOperatingMode.PREPARATION_QC,
        FleetOperatingMode.STAGED_PREPARATION_QC,
      ] as FleetOperatingMode[]).includes(currentWorkflow);
      if (currentPreparationWorkflow && !current.readinessApprovedPreparationId)
        throw new ConflictException(
          'Complete preparation and quality check before activation.',
        );
      const allocated = await tx.allocation.count({
        where: { clientId, fleetId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      });
      if (
        allocated ||
        (current.status !== FleetStatus.PENDING_ACTIVATION &&
          !(preparationWorkflow && current.status === FleetStatus.INSPECTION_PENDING))
      ) {
        throw new ConflictException('Only an unallocated fleet awaiting activation can be activated.');
      }
      const updated = await tx.fleet.update({
        where: { id },
        data: {
          onboardingStatus: 'ACTIVE',
          onboardedAt: fleet.onboardedAt ?? new Date(),
          activatedAt: new Date(),
          status: FleetStatus.AVAILABLE,
          allocationEnabled: !current.allocationBlockedByAdmin,
        },
      });
      await tx.fleetStatusHistory.create({
        data: {
          fleetId: id,
          fromStatus: current.status,
          toStatus: FleetStatus.AVAILABLE,
          changedByUserId: actorId,
          reason: `Fleet onboarding activated (${evidence.operatingMode}).`,
        },
      });
      return this.present({ ...updated, _count: { allocations: 0 } });
    });
  }

  async startTransfer(
    clientId: string,
    fleetId: string,
    destinationHubId: string,
    actorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Fleet" WHERE id=${fleetId} AND "clientId"=${clientId} FOR UPDATE`;
      const fleet = await tx.fleet.findFirst({
        where: { id: fleetId, clientId, deletedAt: null },
      });
      if (!fleet) throw new NotFoundException('Fleet not found.');
      if (fleet.status !== FleetStatus.AVAILABLE)
        throw new ConflictException('Only an available fleet can start a transfer.');
      if (!fleet.currentHubId)
        throw new BadRequestException('Fleet has no current hub.');
      if (fleet.currentHubId === destinationHubId)
        throw new BadRequestException('Destination hub must differ from the current hub.');
      const destination = await tx.hub.findFirst({
        where: {
          id: destinationHubId,
          clientId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!destination) throw new NotFoundException('Destination hub not found.');
      const allocated = await tx.allocation.count({
        where: {
          clientId,
          fleetId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      });
      if (allocated)
        throw new ConflictException('Fleet has an unfinished allocation.');
      const open = await tx.fleetTransfer.findFirst({
        where: {
          clientId,
          fleetId,
          status: { in: [FleetTransferStatus.INITIATED, FleetTransferStatus.IN_TRANSIT] },
        },
        select: { id: true },
      });
      if (open) throw new ConflictException('Fleet already has an active transfer.');
      await tx.fleetTransfer.create({
        data: {
          clientId,
          fleetId,
          fromHubId: fleet.currentHubId,
          toHubId: destinationHubId,
          status: FleetTransferStatus.IN_TRANSIT,
          initiatedById: actorId,
        },
      });
      await tx.fleet.update({
        where: { id: fleetId },
        data: { status: FleetStatus.IN_TRANSIT, allocationEnabled: false },
      });
      await tx.fleetStatusHistory.create({
        data: {
          fleetId,
          fromStatus: fleet.status,
          toStatus: FleetStatus.IN_TRANSIT,
          changedByUserId: actorId,
          reason: 'Fleet transfer started.',
        },
      });
    });
    return this.get(clientId, fleetId);
  }

  async receiveTransfer(
    clientId: string,
    transferId: string,
    actor: AuthUser,
  ) {
    const fleetId = await this.prisma.$transaction(async (tx) => {
      const transfer = await tx.fleetTransfer.findFirst({
        where: { id: transferId, clientId },
      });
      if (!transfer) throw new NotFoundException('Fleet transfer not found.');
      await tx.$queryRaw`SELECT id FROM "FleetTransfer" WHERE id=${transferId} AND "clientId"=${clientId} FOR UPDATE`;
      const current = await tx.fleetTransfer.findFirstOrThrow({
        where: { id: transferId, clientId },
      });
      if (
        !([FleetTransferStatus.INITIATED, FleetTransferStatus.IN_TRANSIT] as FleetTransferStatus[]).includes(
          current.status,
        )
      )
        throw new ConflictException('Fleet transfer has already been received or cancelled.');
      const fleet = await tx.fleet.findFirst({
        where: { id: current.fleetId, clientId, deletedAt: null },
      });
      if (!fleet) throw new NotFoundException('Fleet not found.');
      const destination = await tx.hub.findFirst({
        where: {
          id: current.toHubId,
          clientId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!destination) throw new NotFoundException('Destination hub not found.');
      if (
        !actor.roles.some((role) =>
          [
            'CLIENT_ADMIN',
            'FLEET_MANAGER',
          ].includes(role),
        )
      ) {
        if (!actor.roles.includes('FLEET_MANAGER'))
          throw new ForbiddenException('Destination hub receipt permission is required.');
        const assigned = await tx.userHub.findFirst({
          where: {
            clientId,
            userId: actor.id,
            hubId: current.toHubId,
          },
          select: { id: true },
        });
        if (!assigned)
          throw new ForbiddenException('You are not assigned to the destination hub.');
      }
      if (fleet.status !== FleetStatus.IN_TRANSIT)
        throw new ConflictException('Fleet is not in transit.');
      if (fleet.currentHubId !== current.fromHubId)
        throw new ConflictException('Fleet current hub no longer matches this transfer.');
      const allocated = await tx.allocation.count({
        where: {
          clientId,
          fleetId: current.fleetId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      });
      if (allocated)
        throw new ConflictException('Fleet has an unfinished allocation.');
      // The readiness trigger uses this transaction-local marker to distinguish
      // this receipt from an older matching transfer row.
      await tx.$queryRaw`SELECT set_config('evseye.fleet_transfer_receipt_id', ${transferId}, true)`;
      await tx.fleetTransfer.update({
        where: { id: transferId },
        data: {
          status: FleetTransferStatus.RECEIVED,
          receivedById: actor.id,
          receivedAt: new Date(),
        },
      });
      await tx.fleet.update({
        where: { id: current.fleetId },
        data: {
          currentHubId: current.toHubId,
          status: FleetStatus.AVAILABLE,
          allocationEnabled: !fleet.allocationBlockedByAdmin,
        },
      });
      await tx.fleetStatusHistory.create({
        data: {
          fleetId: current.fleetId,
          fromStatus: FleetStatus.IN_TRANSIT,
          toStatus: FleetStatus.AVAILABLE,
          changedByUserId: actor.id,
          reason: 'Fleet transfer received at destination hub.',
        },
      });
      return current.fleetId;
    });
    const fleet = await this.get(clientId, fleetId);
    return { transfer: await this.prisma.fleetTransfer.findFirstOrThrow({ where: { id: transferId, clientId } }), fleet };
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Fleet" WHERE id=${id} AND "clientId"=${clientId} FOR UPDATE`;
      const fleet = await tx.fleet.findFirst({
        where: { id, clientId, deletedAt: null },
      });
      if (!fleet) throw new NotFoundException('Fleet not found.');
      this.statusPolicy.assertTransition(fleet.status, status);
      if (status === FleetStatus.AVAILABLE && fleet.onboardingStatus !== 'ACTIVE')
        throw new ConflictException('Fleet activation is incomplete.');
      if (
        status === FleetStatus.PENDING_ACTIVATION &&
        fleet.onboardingStatus === 'ACTIVE' &&
        fleet.status !== FleetStatus.IN_TRANSIT
      )
        throw new ConflictException('Active fleet cannot return to pending activation.');
      const updated = await tx.fleet.update({
        where: { id },
        data: { status, ...(['MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'].includes(status) ? { allocationEnabled: false, readinessApprovedPreparationId: null } : {}) },
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
