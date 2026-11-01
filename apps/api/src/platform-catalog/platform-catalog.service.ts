import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImportsService } from '../imports/imports.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../media/storage/storage-provider.interface.js';
import {
  FeatureBillingUnit,
  FeatureCategory,
  FeatureType,
  EnergyType,
  ImportEntityType,
  MasterRecordStatus,
  Prisma,
  VehicleUsageType,
} from '@prisma/client';
import type {
  BulkCreatePackagesDto,
  BulkCreateVehicleCategoriesDto,
  BulkCreateVehicleTypesDto,
  BulkCreateOemsDto,
  BulkCreateFeaturesDto,
  CompleteOemLogoUploadDto,
  CreateOemLogoUploadIntentDto,
  CreateFeatureDto,
  CreateTrainingContentDto,
  CreateTrainingContentUploadIntentDto,
  CreateFeatureStepDto,
  CreatePackageFeatureDto,
  CreatePackageFeatureAssignmentDto,
  CreateFeaturePricingDto,
  CreateOemDto,
  CreatePackageDto,
  CreateVehicleCategoryDto,
  CreateVehicleTypeDto,
  UpdateFeatureDto,
  UpdateTrainingContentDto,
  UpdateFeatureStepDto,
  UpdateFeaturePricingDto,
  UpdateOemDto,
  UpdatePackageDto,
  UpdatePackageFeatureDto,
  UpdateVehicleCategoryDto,
  UpdateVehicleTypeDto,
} from './dto/catalog.dto.js';

const PACKAGE_UNLIMITED_LIMIT = 2_147_483_647;

function uploadFeatureConfiguration(
  billingUnit: FeatureBillingUnit,
  code: string,
  configuration?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (billingUnit !== FeatureBillingUnit.UPLOAD) return configuration;
  const fieldCode = configuration?.fieldCode;
  return {
    ...configuration,
    fieldCode: typeof fieldCode === 'string' && fieldCode.trim() ? fieldCode.trim() : code,
  };
}

function validateFeatureConfiguration(configuration?: Record<string, unknown>) {
  if (configuration === undefined) return;
  if (!configuration || Array.isArray(configuration) || JSON.stringify(configuration).length > 32000)
    throw new BadRequestException('Feature configuration must be a JSON object under 32 KB.');
  if (configuration.appCodes !== undefined && (!Array.isArray(configuration.appCodes) || !configuration.appCodes.every((v) => typeof v === 'string')))
    throw new BadRequestException('Feature appCodes must be a list of strings.');
  if (configuration.supportedLocales !== undefined && (!Array.isArray(configuration.supportedLocales) || !configuration.supportedLocales.every((v) => typeof v === 'string') || new Set(configuration.supportedLocales).size !== configuration.supportedLocales.length))
    throw new BadRequestException('Feature supportedLocales must be a distinct list of strings.');
}

@Injectable()
export class PlatformCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly imports: ImportsService,
  ) {}

  platformImportFailures(jobId: string, entityType: ImportEntityType) {
    return this.imports.platformFailures(jobId, entityType);
  }

  async retryPlatformImport(jobId: string, entityType: ImportEntityType, actorId: string, rows: Array<Record<string, unknown>>) {
    await this.imports.authorizePlatformJob(jobId, entityType);
    switch (entityType) {
      case ImportEntityType.OEM: return this.bulkCreateOems({ rows } as never, actorId);
      case ImportEntityType.VEHICLE_CATEGORY: return this.bulkCreateVehicleCategories({ rows } as never, actorId);
      case ImportEntityType.VEHICLE_TYPE: return this.bulkCreateVehicleTypes({ rows } as never, actorId);
      case ImportEntityType.FEATURE: return this.bulkCreateFeatures({ rows } as never, actorId);
      case ImportEntityType.PACKAGE: return this.bulkCreatePackages({ rows } as never, actorId);
      default: throw new BadRequestException('Unsupported platform import entity.');
    }
  }

  async dashboard() {
    const [
      clients,
      activeClients,
      pendingClients,
      fleets,
      riders,
      packages,
      oems,
      features,
      pricing,
      subscriptions,
      vehicleCategories,
      vehicleTypes,
      clientsByStatus,
      fleetsByStatus,
      ridersByStatus,
    ] = await Promise.all([
      this.prisma.client.count(),
      this.prisma.client.count({ where: { status: 'ACTIVE', isActive: true } }),
      this.prisma.client.count({ where: { status: 'PENDING_APPROVAL' } }),
      this.prisma.fleet.count({ where: { deletedAt: null } }),
      this.prisma.rider.count({ where: { deletedAt: null } }),
      this.prisma.package.count({ where: { isActive: true } }),
      this.prisma.oem.count({ where: { status: 'ACTIVE' } }),
      this.prisma.feature.count({ where: { isActive: true } }),
      this.prisma.featurePricing.count({ where: { isActive: true } }),
      this.prisma.clientSubscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.vehicleCategory.count({ where: { status: 'ACTIVE' } }),
      this.prisma.vehicleType.count({ where: { status: 'ACTIVE' } }),
      this.prisma.client.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.fleet.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.rider.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const statusCounts = <
      T extends { status: string; _count: { _all: number } },
    >(
      values: T[],
    ) =>
      Object.fromEntries(
        values.map((value) => [value.status, value._count._all]),
      );

    return {
      clients,
      activeClients,
      pendingClients,
      fleets,
      riders,
      packages,
      oems,
      features,
      pricing,
      subscriptions,
      vehicleCategories,
      vehicleTypes,
      clientsByStatus: statusCounts(clientsByStatus),
      fleetsByStatus: statusCounts(fleetsByStatus),
      ridersByStatus: statusCounts(ridersByStatus),
    };
  }

  async listOems() {
    const oems = await this.prisma.oem.findMany({
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
    });
    return oems.map((oem) => this.serializeOem(oem));
  }
  async createOem(dto: CreateOemDto, actorId: string) {
    const oem = await this.createWithAudit('OEM_CREATED', 'OEM', actorId, () =>
      this.prisma.oem.create({ data: dto }),
    );
    return this.serializeOem(oem);
  }
  async updateOem(id: string, dto: UpdateOemDto, actorId: string) {
    const current = await this.prisma.oem.findUnique({ where: { id }, select: { code: true } });
    if (!current) throw new NotFoundException('Record not found.');
    if (dto.code !== current.code) throw new BadRequestException('OEM code cannot be changed after creation.');
    const { code: _code, ...data } = dto;
    const oem = await this.updateWithAudit('OEM_UPDATED', 'OEM', id, actorId, () =>
      this.prisma.oem.update({ where: { id }, data }),
    );
    return this.serializeOem(oem);
  }
  async deleteOem(id: string, actorId: string) {
    await this.exists('oem', id);
    if (await this.prisma.fleet.count({ where: { oemId: id, deletedAt: null } })) throw new ConflictException('OEM is referenced by active Fleets and cannot be deactivated.');
    await this.prisma.oem.update({ where: { id }, data: { status: MasterRecordStatus.INACTIVE } });
    await this.audit.record({
      actorId,
      action: 'OEM_DEACTIVATED',
      entityType: 'OEM',
      entityId: id,
    });
  }
  async createOemLogoUploadIntent(
    id: string,
    dto: CreateOemLogoUploadIntentDto,
  ) {
    await this.exists('oem', id);
    const objectKey = `platform/oems/${id}/logo/${randomUUID()}.${this.extensionFor(dto.mimeType)}`;
    const uploadUrl = await this.storage.createUploadUrl({
      objectKey,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });
    return { objectKey, uploadUrl };
  }
  async completeOemLogoUpload(
    id: string,
    dto: CompleteOemLogoUploadDto,
    actorId: string,
  ) {
    await this.exists('oem', id);
    if (!dto.objectKey.startsWith(`platform/oems/${id}/logo/`)) {
      throw new BadRequestException(
        'The logo upload does not belong to this OEM.',
      );
    }
    await this.storage.assertObjectExists(dto.objectKey);
    const updated = await this.prisma.oem.update({
      where: { id },
      data: { logoObjectKey: dto.objectKey },
    });
    await this.audit.record({
      actorId,
      action: 'OEM_LOGO_UPLOADED',
      entityType: 'OEM',
      entityId: id,
    });
    return this.serializeOem(updated);
  }
  async bulkCreateOems(dto: BulkCreateOemsDto, actorId: string) {
    const validStatuses = new Set(Object.values(MasterRecordStatus));
    const codes = new Set<string>();
    const rows = dto.rows.map((row, index) => {
      const normalized = {
        ...row,
        code: row.code?.trim().toUpperCase(),
        name: row.name?.trim(),
        displayName: row.displayName?.trim(),
        status: row.status?.trim().toUpperCase() as MasterRecordStatus,
      };
      if (
        !normalized.code ||
        !/^[A-Z0-9_-]{1,40}$/.test(normalized.code) ||
        !normalized.name ||
        !normalized.displayName ||
        !validStatuses.has(normalized.status)
      )
        throw new ConflictException(
          `Row ${index + 2} is invalid. Check code, name, display name, and status.`,
        );
      if (codes.has(normalized.code))
        throw new ConflictException(
          `Duplicate OEM code ${normalized.code} in the upload.`,
        );
      codes.add(normalized.code);
      return normalized;
    });
    const job = await this.imports.createPlatformJob(actorId, ImportEntityType.OEM, 'oems-bulk', rows.length, { entityType: 'OEM' });
    try {
      const result = await this.createPlatformRows(rows, (row) => this.prisma.oem.create({ data: row }));
      await this.audit.record({
        actorId,
        action: 'OEM_BULK_CREATED',
        entityType: 'OEM',
        entityId: 'bulk',
        newData: { count: result.passedRows, codes: rows.map((row) => row.code) },
      });
      return await this.imports.completePlatformJob(job.id, { ...result, createdRows: result.passedRows });
    } catch (error) {
      if (this.unique(error))
        return await this.imports.completePlatformJob(job.id, { passedRows: 0, failures: rows.map((row, index) => ({ ...row, row_number: index + 2, failure_reason: 'The OEM code already exists.' })) });
      throw error;
    }
  }

  private serializeOem<T extends { logoObjectKey: string | null }>(oem: T) {
    return {
      ...oem,
      // Persist only the portable object key. The delivery URL is calculated
      // here so it can differ safely between local MinIO and production CDN.
      logoUrl: oem.logoObjectKey
        ? this.storage.createPublicUrl(oem.logoObjectKey)
        : null,
    };
  }

  listVehicleCategories() {
    return this.prisma.vehicleCategory.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }
  async createVehicleCategory(dto: CreateVehicleCategoryDto, actorId: string) {
    return this.createWithAudit(
      'VEHICLE_CATEGORY_CREATED',
      'VehicleCategory',
      actorId,
      () =>
        this.prisma.vehicleCategory.create({
          data: dto,
        }),
    );
  }
  async updateVehicleCategory(
    id: string,
    dto: UpdateVehicleCategoryDto,
    actorId: string,
  ) {
    const current = await this.prisma.vehicleCategory.findUnique({ where: { id }, select: { code: true } });
    if (!current) throw new NotFoundException('Record not found.');
    if (dto.code !== current.code) throw new BadRequestException('Vehicle Category code cannot be changed after creation.');
    const { code: _code, ...data } = dto;
    return this.updateWithAudit(
      'VEHICLE_CATEGORY_UPDATED',
      'VehicleCategory',
      id,
      actorId,
      () =>
        this.prisma.vehicleCategory.update({
          where: { id },
          data,
        }),
    );
  }
  async deleteVehicleCategory(id: string, actorId: string) {
    await this.exists('vehicleCategory', id);
    if (await this.prisma.vehicleType.count({ where: { categoryId: id, status: MasterRecordStatus.ACTIVE } })) throw new ConflictException('Vehicle Category has active Vehicle Types and cannot be deactivated.');
    await this.prisma.vehicleCategory.update({ where: { id }, data: { status: MasterRecordStatus.INACTIVE } });
    await this.audit.record({
      actorId,
      action: 'VEHICLE_CATEGORY_DEACTIVATED',
      entityType: 'VehicleCategory',
      entityId: id,
    });
  }
  async bulkCreateVehicleCategories(
    dto: BulkCreateVehicleCategoriesDto,
    actorId: string,
  ) {
    const codes = new Set<string>();
    const statuses = new Set(Object.values(MasterRecordStatus));
    const rows = dto.rows.map((row, index) => {
      const normalized = {
        code: row.code?.trim().toUpperCase(),
        name: row.name?.trim(),
        description: row.description?.trim() || undefined,
        translations: row.translations,
        status: (row.status ?? 'ACTIVE').toString().toUpperCase(),
        displayOrder: Number(row.displayOrder ?? 0),
      };
      if (
        !normalized.code ||
        !/^[A-Z0-9_-]{1,50}$/.test(normalized.code) ||
        !normalized.name ||
        normalized.name.length > 120 ||
        (normalized.description && normalized.description.length > 500) ||
        !statuses.has(normalized.status as MasterRecordStatus) ||
        !Number.isInteger(normalized.displayOrder) ||
        normalized.displayOrder < 0
      ) {
        throw new BadRequestException(
          `Row ${index + 2} is invalid. Check code, name, status, and display order.`,
        );
      }
      if (codes.has(normalized.code)) {
        throw new ConflictException(
          `Duplicate vehicle category code ${normalized.code} in the upload.`,
        );
      }
      codes.add(normalized.code);
      return {
        ...normalized,
        status: normalized.status as MasterRecordStatus,
      };
    });
    const job = await this.imports.createPlatformJob(actorId, ImportEntityType.VEHICLE_CATEGORY, 'vehicle-categories-bulk', rows.length, { entityType: 'VEHICLE_CATEGORY' });
    try {
      const result = await this.createBulk(rows, (row) => this.prisma.vehicleCategory.create({ data: row }), actorId, 'VEHICLE_CATEGORY_BULK_CREATED', 'VehicleCategory', 'vehicle category code');
      return await this.imports.completePlatformJob(job.id, { ...result, createdRows: result.passedRows });
    } catch (error) {
      if (error instanceof ConflictException) return await this.imports.completePlatformJob(job.id, { passedRows: 0, failures: rows.map((row, index) => ({ ...row, row_number: index + 2, failure_reason: error.message })) });
      throw error;
    }
  }
  listVehicleTypes() {
    return this.prisma.vehicleType.findMany({
      include: { category: true },
      orderBy: [{ category: { displayOrder: 'asc' } }, { name: 'asc' }],
    });
  }
  async createVehicleType(dto: CreateVehicleTypeDto, actorId: string) {
    const category = await this.prisma.vehicleCategory.findUnique({ where: { id: dto.categoryId }, select: { id: true, status: true } });
    if (!category || ('status' in category && category.status !== MasterRecordStatus.ACTIVE)) {
      throw new NotFoundException('Active vehicle category not found.');
    }
    return this.createWithAudit(
      'VEHICLE_TYPE_CREATED',
      'VehicleType',
      actorId,
      () =>
        this.prisma.vehicleType.create({
          data: dto,
          include: { category: true },
        }),
    );
  }
  async updateVehicleType(
    id: string,
    dto: UpdateVehicleTypeDto,
    actorId: string,
  ) {
    const current = await this.prisma.vehicleType.findUnique({ where: { id }, select: { code: true } });
    if (!current) throw new NotFoundException('Record not found.');
    if (dto.code !== current.code) throw new BadRequestException('Vehicle Type code cannot be changed after creation.');
    const { code: _code, ...data } = dto;
    const category = await this.prisma.vehicleCategory.findUnique({ where: { id: dto.categoryId }, select: { id: true, status: true } });
    if (!category || ('status' in category && category.status !== MasterRecordStatus.ACTIVE)) {
      throw new NotFoundException('Active vehicle category not found.');
    }
    return this.updateWithAudit(
      'VEHICLE_TYPE_UPDATED',
      'VehicleType',
      id,
      actorId,
      () =>
        this.prisma.vehicleType.update({
          where: { id },
          data,
          include: { category: true },
        }),
    );
  }
  async deleteVehicleType(id: string, actorId: string) {
    await this.exists('vehicleType', id);
    if (await this.prisma.fleet.count({ where: { vehicleTypeId: id, deletedAt: null } })) throw new ConflictException('Vehicle Type is referenced by active Fleets and cannot be deactivated.');
    await this.prisma.vehicleType.update({ where: { id }, data: { status: MasterRecordStatus.INACTIVE } });
    await this.audit.record({
      actorId,
      action: 'VEHICLE_TYPE_DEACTIVATED',
      entityType: 'VehicleType',
      entityId: id,
    });
  }
  async bulkCreateVehicleTypes(
    dto: BulkCreateVehicleTypesDto,
    actorId: string,
  ) {
    const categoryCodes = new Set<string>();
    const codes = new Set<string>();
    const energyTypes = new Set(Object.values(EnergyType));
    const usageTypes = new Set(Object.values(VehicleUsageType));
    const statuses = new Set(Object.values(MasterRecordStatus));
    const rows = dto.rows.map((row, index) => {
      const normalized = {
        categoryCode: row.categoryCode?.trim().toUpperCase(),
        code: row.code?.trim().toUpperCase(),
        name: row.name?.trim(),
        subCategory: row.subCategory?.trim() || undefined,
        description: row.description?.trim() || undefined,
        translations: row.translations,
        energyType: row.energyType?.toString().trim().toUpperCase(),
        usageType: row.usageType?.toString().trim().toUpperCase() || undefined,
        status: (row.status ?? 'ACTIVE').toString().toUpperCase(),
      };
      if (
        !normalized.categoryCode ||
        !normalized.code ||
        !/^[A-Z0-9_-]{1,50}$/.test(normalized.code) ||
        !normalized.name ||
        normalized.name.length > 120 ||
        (normalized.subCategory && normalized.subCategory.length > 120) ||
        (normalized.description && normalized.description.length > 500) ||
        !energyTypes.has(normalized.energyType as EnergyType) ||
        (normalized.usageType &&
          !usageTypes.has(normalized.usageType as VehicleUsageType)) ||
        !statuses.has(normalized.status as MasterRecordStatus)
      ) {
        throw new BadRequestException(
          `Row ${index + 2} is invalid. Check category code, type code, name, energy type, usage type, and status.`,
        );
      }
      if (codes.has(normalized.code)) {
        throw new ConflictException(
          `Duplicate vehicle type code ${normalized.code} in the upload.`,
        );
      }
      codes.add(normalized.code);
      categoryCodes.add(normalized.categoryCode);
      return normalized;
    });
    const categories = await this.prisma.vehicleCategory.findMany({
      where: { code: { in: [...categoryCodes] } },
      select: { id: true, code: true },
    });
    const categoryIdByCode = new Map(
      categories.map((category) => [category.code, category.id]),
    );
    for (const categoryCode of categoryCodes) {
      if (!categoryIdByCode.has(categoryCode)) {
        throw new BadRequestException(
          `Vehicle category code ${categoryCode} does not exist.`,
        );
      }
    }
    const mappedRows = rows.map(({ categoryCode, ...row }) => ({
        ...row,
        categoryId: categoryIdByCode.get(categoryCode)!,
        energyType: row.energyType as EnergyType,
        usageType: row.usageType as VehicleUsageType | undefined,
        status: row.status as MasterRecordStatus,
      }));
    const job = await this.imports.createPlatformJob(actorId, ImportEntityType.VEHICLE_TYPE, 'vehicle-types-bulk', rows.length, { entityType: 'VEHICLE_TYPE' });
    try {
      const result = await this.createBulk(mappedRows, (row) => this.prisma.vehicleType.create({ data: row }), actorId, 'VEHICLE_TYPE_BULK_CREATED', 'VehicleType', 'vehicle type code');
      const failures = result.failures.map((failure) => {
        const rowIndex = Number(failure.row ?? failure.row_number) - 2;
        const source = rows[rowIndex];
        return source?.categoryCode
          ? { ...failure, categoryCode: source.categoryCode }
          : failure;
      });
      return await this.imports.completePlatformJob(job.id, { ...result, failures, createdRows: result.passedRows });
    } catch (error) {
      if (error instanceof ConflictException) return await this.imports.completePlatformJob(job.id, { passedRows: 0, failures: rows.map((row, index) => ({ ...row, row_number: index + 2, failure_reason: error.message })) });
      throw error;
    }
  }

  listFeatures() {
    return this.prisma.feature.findMany({
      include: {
        featureStep: true,
        pricing: {
          where: { isActive: true },
          orderBy: { effectiveFrom: 'desc' },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }
  async createFeature(dto: CreateFeatureDto, actorId: string) {
    const { configuration, translations, featureStepId, ...data } = dto;
    validateFeatureConfiguration(configuration);
    if (featureStepId) await this.requireFeatureStep(featureStepId);
    const effectiveConfiguration = uploadFeatureConfiguration(dto.billingUnit, dto.code, configuration);
    return this.createWithAudit('FEATURE_CREATED', 'Feature', actorId, () =>
      this.prisma.feature.create({
        data: {
          ...data,
          ...(translations ? { translations: translations as Prisma.InputJsonValue } : {}),
          ...(featureStepId ? { featureStepId } : {}),
          ...(effectiveConfiguration !== undefined
            ? { configuration: effectiveConfiguration as Prisma.InputJsonValue }
            : {}),
        },
      }),
    );
  }
  async updateFeature(id: string, dto: UpdateFeatureDto, actorId: string) {
    const existing = await this.prisma.feature.findUnique({ where: { id }, select: { configuration: true } });
    if (!existing) throw new NotFoundException('Feature not found.');
    const { configuration, translations, featureStepId, ...data } = dto;
    if (featureStepId) await this.requireFeatureStep(featureStepId);
    const currentConfiguration = existing.configuration && typeof existing.configuration === 'object' && !Array.isArray(existing.configuration)
      ? existing.configuration as Record<string, unknown>
      : undefined;
    validateFeatureConfiguration(configuration ?? currentConfiguration);
    const effectiveConfiguration = uploadFeatureConfiguration(dto.billingUnit, dto.code, configuration ?? currentConfiguration);
    return this.updateWithAudit('FEATURE_UPDATED', 'Feature', id, actorId, () =>
      this.prisma.feature.update({
        where: { id },
        data: {
          ...data,
          ...(translations ? { translations: translations as Prisma.InputJsonValue } : {}),
          ...(featureStepId !== undefined ? { featureStepId } : {}),
          ...(effectiveConfiguration !== undefined
            ? { configuration: effectiveConfiguration as Prisma.InputJsonValue }
            : {}),
        },
      }),
    );
  }
  listTrainingContent() {
    return this.prisma.trainingContent.findMany({
      include: { feature: { select: { id: true, code: true, name: true } } },
      orderBy: [{ feature: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { title: 'asc' }],
    });
  }
  async createTrainingContentUploadIntent(dto: CreateTrainingContentUploadIntentDto) {
    const objectKey = `platform/training/${dto.code}/${randomUUID()}.${this.extensionFor(dto.mimeType)}`;
    return {
      objectKey,
      uploadUrl: await this.storage.createUploadUrl({ objectKey, mimeType: dto.mimeType, sizeBytes: dto.sizeBytes }),
    };
  }
  async createTrainingContent(dto: CreateTrainingContentDto, actorId: string) {
    const feature = await this.prisma.feature.findFirst({ where: { id: dto.featureId, code: 'SHOW_TRAINING', isActive: true }, select: { id: true } });
    if (!feature) throw new BadRequestException('Training content must be assigned to the active SHOW_TRAINING feature.');
    if (!dto.imageObjectKey.startsWith(`platform/training/${dto.code}/`)) throw new BadRequestException('The uploaded image does not belong to this training content code.');
    await this.storage.assertObjectExists(dto.imageObjectKey);
    const { translations, ...data } = dto;
    return this.createWithAudit('TRAINING_CONTENT_CREATED', 'TrainingContent', actorId, () => this.prisma.trainingContent.create({ data: { ...data, ...(translations ? { translations: translations as Prisma.InputJsonValue } : {}) } }));
  }
  async updateTrainingContent(id: string, dto: UpdateTrainingContentDto, actorId: string) {
    await this.exists('trainingContent', id);
    const feature = await this.prisma.feature.findFirst({ where: { id: dto.featureId, code: 'SHOW_TRAINING', isActive: true }, select: { id: true } });
    if (!feature) throw new BadRequestException('Training content must be assigned to the active SHOW_TRAINING feature.');
    if (!dto.imageObjectKey.startsWith(`platform/training/${dto.code}/`)) throw new BadRequestException('The uploaded image does not belong to this training content code.');
    await this.storage.assertObjectExists(dto.imageObjectKey);
    const { translations, ...data } = dto;
    return this.updateWithAudit('TRAINING_CONTENT_UPDATED', 'TrainingContent', id, actorId, () => this.prisma.trainingContent.update({ where: { id }, data: { ...data, ...(translations ? { translations: translations as Prisma.InputJsonValue } : {}) } }));
  }
  async deactivateTrainingContent(id: string, actorId: string) {
    await this.exists('trainingContent', id);
    return this.updateWithAudit('TRAINING_CONTENT_DEACTIVATED', 'TrainingContent', id, actorId, () => this.prisma.trainingContent.update({ where: { id }, data: { isActive: false } }));
  }
  listFeatureSteps() {
    return this.prisma.featureStep.findMany({
      include: {
        parent: { select: { id: true, code: true, displayName: true } },
        _count: { select: { features: true, children: true } },
      },
      orderBy: [{ displayOrder: 'asc' }, { displayName: 'asc' }],
    });
  }
  async createFeatureStep(dto: CreateFeatureStepDto, actorId: string) {
    if (dto.parentId) await this.requireFeatureStep(dto.parentId);
    const { translations, ...data } = dto;
    return this.createWithAudit('FEATURE_STEP_CREATED', 'FeatureStep', actorId, () =>
      this.prisma.featureStep.create({ data: { ...data, ...(translations ? { translations: translations as Prisma.InputJsonValue } : {}) } }),
    );
  }
  async updateFeatureStep(id: string, dto: UpdateFeatureStepDto, actorId: string) {
    await this.requireFeatureStep(id, false);
    if (dto.parentId) await this.validateFeatureStepParent(id, dto.parentId);
    const { translations, ...data } = dto;
    return this.updateWithAudit('FEATURE_STEP_UPDATED', 'FeatureStep', id, actorId, () =>
      this.prisma.featureStep.update({ where: { id }, data: { ...data, ...(translations ? { translations: translations as Prisma.InputJsonValue } : {}) } }),
    );
  }
  async deleteFeatureStep(id: string, actorId: string) {
    await this.requireFeatureStep(id, false);
    const [children, features] = await Promise.all([
      this.prisma.featureStep.count({ where: { parentId: id } }),
      this.prisma.feature.count({ where: { featureStepId: id } }),
    ]);
    if (children) throw new ConflictException('Reassign or remove child Feature Steps before deleting this step.');
    if (features) {
      await this.prisma.featureStep.update({ where: { id }, data: { isActive: false } });
    } else {
      await this.prisma.featureStep.delete({ where: { id } });
    }
    await this.audit.record({ actorId, action: 'FEATURE_STEP_DELETED', entityType: 'FeatureStep', entityId: id, newData: { deactivated: Boolean(features) } });
  }
  async deleteFeature(id: string, actorId: string) {
    await this.exists('feature', id);
    const activeSubscriptions = await this.prisma.clientSubscription.count({
      where: {
        status: 'ACTIVE',
        package: { features: { some: { featureId: id } } },
      },
    });
    if (activeSubscriptions) {
      throw new ConflictException(
        'This feature is enabled in a package with an active client subscription and cannot be deleted.',
      );
    }
    const referenced = await this.prisma.featureUsageLedger.count({ where: { featureId: id } });
    if (referenced) throw new ConflictException('A feature with commercial history cannot be deleted. Deactivate it instead.');
    await this.prisma.feature.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      actorId,
      action: 'FEATURE_DELETED',
      entityType: 'Feature',
      entityId: id,
      newData: { isActive: false },
    });
  }
  async bulkCreateFeatures(dto: BulkCreateFeaturesDto, actorId: string) {
    const validCategories = new Set(Object.values(FeatureCategory));
    const validTypes = new Set(Object.values(FeatureType));
    const validUnits = new Set(Object.values(FeatureBillingUnit));
    const codes = new Set<string>();
    const rows = dto.rows.map((row, index) => {
      const normalized = {
        code: row.code?.trim().toUpperCase(),
        name: row.name?.trim(),
        description: row.description?.trim() || undefined,
        category: row.category?.trim().toUpperCase() as FeatureCategory,
        featureType: row.featureType?.trim().toUpperCase() as FeatureType,
        billingUnit: row.billingUnit
          ?.trim()
          .toUpperCase() as FeatureBillingUnit,
        displayOrder: Number(row.displayOrder ?? 0),
        isActive:
          typeof row.isActive === 'boolean'
            ? row.isActive
            : String(row.isActive ?? 'true').toLowerCase() === 'true',
      };
      if (
        !normalized.code ||
        !/^[A-Z0-9_-]{1,100}$/.test(normalized.code) ||
        !normalized.name ||
        normalized.name.length > 150 ||
        (normalized.description && normalized.description.length > 500) ||
        !validCategories.has(normalized.category) ||
        !validTypes.has(normalized.featureType) ||
        !validUnits.has(normalized.billingUnit) ||
        !Number.isInteger(normalized.displayOrder) ||
        normalized.displayOrder < 0
      ) {
        throw new ConflictException(
          `Row ${index + 2} is invalid. Check code, name, category, type, billing unit, and display order.`,
        );
      }
      if (codes.has(normalized.code)) {
        throw new ConflictException(
          `Duplicate feature code ${normalized.code} in the upload.`,
        );
      }
      codes.add(normalized.code);
      return {
        ...normalized,
        ...(normalized.billingUnit === FeatureBillingUnit.UPLOAD
          ? { configuration: { fieldCode: normalized.code } }
          : {}),
      };
    });
    const job = await this.imports.createPlatformJob(actorId, ImportEntityType.FEATURE, 'features-bulk', rows.length, { entityType: 'FEATURE' });
    try {
      const result = await this.createPlatformRows(rows, (row) => this.prisma.feature.create({ data: row }));
      await this.audit.record({
        actorId,
        action: 'FEATURE_BULK_CREATED',
        entityType: 'Feature',
        entityId: 'bulk',
        newData: { count: result.passedRows, codes: rows.map((row) => row.code) },
      });
      return await this.imports.completePlatformJob(job.id, { ...result, createdRows: result.passedRows });
    } catch (error) {
      if (this.unique(error)) {
        return await this.imports.completePlatformJob(job.id, { passedRows: 0, failures: rows.map((row, index) => ({ ...row, row_number: index + 2, failure_reason: 'The feature code already exists.' })) });
      }
      throw error;
    }
  }

  listPackages() {
    return this.prisma.package
      .findMany({
        include: {
          features: {
            include: {
              feature: true,
            },
            orderBy: { displayOrder: 'asc' },
          },
          _count: { select: { subscriptions: true } },
        },
        orderBy: [
          { isCustom: 'desc' },
          { displayOrder: 'asc' },
          { name: 'asc' },
        ],
      })
      .then((packages) => this.jsonSafe(packages));
  }
  async createPackage(dto: CreatePackageDto, actorId: string) {
    const data = dto;
    const created = await this.createWithAudit(
      'PACKAGE_CREATED',
      'Package',
      actorId,
      () =>
        this.prisma.$transaction(async (tx) => {
          return tx.package.create({
            data,
            include: {
              features: {
                include: {
                  feature: true,
                },
              },
            },
          });
        }),
    );
    return this.jsonSafe(created);
  }
  async updatePackage(id: string, dto: UpdatePackageDto, actorId: string) {
    await this.exists('package', id);
    const data = dto;
    const updated = await this.updateWithAudit(
      'PACKAGE_UPDATED',
      'Package',
      id,
      actorId,
      () =>
        this.prisma.package.update({
            where: { id },
            data,
            include: {
              features: {
                include: {
                  feature: true,
                },
              },
            },
          }),
    );
    return this.jsonSafe(updated);
  }
  listPackageFeatures() {
    return this.prisma.packageFeature
      .findMany({
        include: { package: true, feature: true },
        orderBy: [{ package: { name: 'asc' } }, { displayOrder: 'asc' }],
      })
      .then((links) => this.jsonSafe(links));
  }
  async createPackageFeature(
    dto: CreatePackageFeatureAssignmentDto,
    actorId: string,
  ) {
    const [pkg, featureRecord] = await Promise.all([
      this.prisma.package.findUnique({ where: { id: dto.packageId }, select: { id: true, isActive: true } }),
      this.prisma.feature.findUnique({ where: { id: dto.featureId }, select: { id: true, isActive: true } }),
    ]);
    if (!pkg) throw new NotFoundException('Package not found.');
    if (!featureRecord) throw new NotFoundException('Feature not found.');
    if (!pkg.isActive) throw new BadRequestException('Inactive Packages cannot receive Feature assignments.');
    if (!featureRecord.isActive) throw new BadRequestException('Only active Features can be assigned to a Package.');
    const { packageId, featureId, ...featureData } = dto;
    try {
      const created = await this.createWithAudit(
        'PACKAGE_FEATURE_CREATED',
        'PackageFeature',
        actorId,
        () =>
          this.prisma.packageFeature.create({
            data: { packageId, featureId, ...this.packageFeatureData(featureData) },
            include: { package: true, feature: true },
          }),
      );
      return this.jsonSafe(created);
    } catch (error) {
      if (this.unique(error)) {
        throw new ConflictException('This Feature is already assigned to the selected Package.');
      }
      throw error;
    }
  }
  async updatePackageFeature(
    id: string,
    dto: UpdatePackageFeatureDto,
    actorId: string,
  ) {
    const existing = await this.prisma.packageFeature.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Package Feature not found.');
    const updated = await this.updateWithAudit(
      'PACKAGE_FEATURE_UPDATED',
      'PackageFeature',
      id,
      actorId,
      () =>
        this.prisma.packageFeature.update({
          where: { id },
          data: this.packageFeatureData(dto),
          include: { package: true, feature: true },
        }),
    );
    return this.jsonSafe(updated);
  }
  async deletePackageFeature(id: string, actorId: string) {
    const existing = await this.prisma.packageFeature.findUnique({ where: { id }, include: { package: true } });
    if (!existing) throw new NotFoundException('Package Feature not found.');
    const activeSubscriptions = await this.prisma.clientSubscription.count({ where: { packageId: existing.packageId, status: 'ACTIVE' } });
    if (activeSubscriptions) throw new ConflictException('This Package Feature is assigned to an active client subscription and cannot be removed. Publish a new Package revision instead.');
    await this.prisma.packageFeature.update({ where: { id }, data: { isIncluded: false } });
    await this.audit.record({
      actorId,
      action: 'PACKAGE_FEATURE_DELETED',
      entityType: 'PackageFeature',
      entityId: id,
    });
  }
  async deletePackage(id: string, actorId: string) {
    await this.exists('package', id);
    const subscriptions = await this.prisma.clientSubscription.count({
      where: { packageId: id, status: 'ACTIVE' },
    });
    if (subscriptions)
      throw new ConflictException(
        'An active client subscription uses this package.',
      );
    await this.prisma.package.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      actorId,
      action: 'PACKAGE_DELETED',
      entityType: 'Package',
      entityId: id,
    });
  }
  async bulkCreatePackages(dto: BulkCreatePackagesDto, actorId: string) {
    const codes = new Set<string>();
    const rows = dto.rows.map((row, index) => {
      const optionalNumber = (value: unknown) => {
        if (value === undefined || value === null || value === '') return undefined;
        if (
          typeof value === 'string' &&
          ['MAX_INT', 'UNLIMITED'].includes(value.trim().toUpperCase())
        ) {
          return PACKAGE_UNLIMITED_LIMIT;
        }
        return Number(value);
      };
      const normalized = {
        code: row.code?.trim().toUpperCase(),
        name: row.name?.trim(),
        setupFee: optionalNumber(row.setupFee) ?? 0,
        currency: (row.currency ?? 'INR').toString().trim().toUpperCase(),
        maxFleets: optionalNumber(row.maxFleets) ?? PACKAGE_UNLIMITED_LIMIT,
        maxRiders: optionalNumber(row.maxRiders) ?? PACKAGE_UNLIMITED_LIMIT,
        maxAdmins: optionalNumber(row.maxAdmins) ?? PACKAGE_UNLIMITED_LIMIT,
        maxFleetManagers: optionalNumber(row.maxFleetManagers) ?? PACKAGE_UNLIMITED_LIMIT,
        maxHubs: optionalNumber(row.maxHubs) ?? PACKAGE_UNLIMITED_LIMIT,
        maxTeamLeaders: optionalNumber(row.maxTeamLeaders) ?? PACKAGE_UNLIMITED_LIMIT,
        maxClusterManagers: optionalNumber(row.maxClusterManagers) ?? PACKAGE_UNLIMITED_LIMIT,
        maxUsers: optionalNumber(row.maxUsers) ?? PACKAGE_UNLIMITED_LIMIT,
        trialDays: Number(row.trialDays ?? 0),
        displayOrder: Number(row.displayOrder ?? 0),
        isCustom: this.toBoolean(row.isCustom, false),
        isActive: this.toBoolean(row.isActive, true),
        description: row.description?.trim() || undefined,
      };
      const integerFields = [
        normalized.maxFleets,
        normalized.maxRiders,
        normalized.maxAdmins,
        normalized.maxFleetManagers,
        normalized.maxHubs,
        normalized.maxTeamLeaders,
        normalized.maxClusterManagers,
        normalized.maxUsers,
        normalized.trialDays,
        normalized.displayOrder,
      ];
      const monetaryFields = [normalized.setupFee];
      if (
        !normalized.code ||
        !/^[A-Z0-9_-]{1,50}$/.test(normalized.code) ||
        !normalized.name ||
        normalized.name.length > 100 ||
        !/^[A-Z]{3}$/.test(normalized.currency) ||
        (normalized.description && normalized.description.length > 500) ||
        integerFields.some(
          (value) =>
            value !== undefined && (!Number.isInteger(value) || value < 0),
        ) ||
        monetaryFields.some(
          (value) =>
            value !== undefined && (!Number.isFinite(value) || value < 0),
        )
      ) {
        throw new BadRequestException(
          `Row ${index + 2} is invalid. Check package code, name, prices, limits, and status values.`,
        );
      }
      if (codes.has(normalized.code)) {
        throw new ConflictException(
          `Duplicate package code ${normalized.code} in the upload.`,
        );
      }
      codes.add(normalized.code);
      return normalized;
    });
    const job = await this.imports.createPlatformJob(actorId, ImportEntityType.PACKAGE, 'packages-bulk', rows.length, { entityType: 'PACKAGE' });
    try {
      const result = await this.createPlatformRows(rows, (row) => this.prisma.package.create({ data: row }));
      await this.audit.record({
        actorId,
        action: 'PACKAGE_BULK_CREATED',
        entityType: 'Package',
        entityId: 'bulk',
        newData: { count: result.passedRows, codes: rows.map((row) => row.code) },
      });
      return await this.imports.completePlatformJob(job.id, { ...result, createdRows: result.passedRows });
    } catch (error) {
      if (this.unique(error)) {
        return await this.imports.completePlatformJob(job.id, { passedRows: 0, failures: rows.map((row, index) => ({ ...row, row_number: index + 2, failure_reason: 'The package code already exists.' })) });
      }
      throw error;
    }
  }

  listPricing() {
    return this.prisma.featurePricing
      .findMany({
        include: { feature: true },
        orderBy: { updatedAt: 'desc' },
      })
      .then((pricing) => this.jsonSafe(pricing));
  }
  async createPricing(dto: CreateFeaturePricingDto, actorId: string) {
    this.validatePricing(dto);
    await this.exists('feature', dto.featureId);
    await this.assertNoPricingOverlap(dto);
    const created = await this.createWithAudit(
      'FEATURE_PRICING_CREATED',
      'FeaturePricing',
      actorId,
      () =>
        this.prisma.featurePricing.create({
          data: this.pricingData(dto),
          include: { feature: true },
        }),
    );
    return this.jsonSafe(created);
  }
  async updatePricing(
    id: string,
    dto: UpdateFeaturePricingDto,
    actorId: string,
  ) {
    const current = await this.prisma.featurePricing.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Feature pricing not found.');
    this.validatePricing(dto); await this.exists('feature', dto.featureId); await this.assertNoPricingOverlap(dto, id);
    const replacement = await this.prisma.$transaction(async (tx) => {
      await tx.featurePricing.update({ where: { id }, data: { isActive: false, effectiveTo: new Date(dto.effectiveFrom) } });
      return tx.featurePricing.create({ data: this.pricingData(dto), include: { feature: true } });
    });
    await this.audit.record({ actorId, action: 'FEATURE_PRICING_VERSION_CREATED', entityType: 'FeaturePricing', entityId: replacement.id, previousData: { replacedPricingId: id } });
    return this.jsonSafe(replacement);
  }

  async getCurrentPricing(featureId: string, effectiveDate = new Date()) {
    const pricing = await this.prisma.featurePricing.findFirst({
      where: { featureId, isActive: true, effectiveFrom: { lte: effectiveDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }] },
      include: { feature: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!pricing) throw new NotFoundException('No active feature price is configured for this effective date.');
    return this.jsonSafe(pricing);
  }

  private validatePricing(dto: CreateFeaturePricingDto) {
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : undefined;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException(
        'Effective end date must be on or after the effective start date.',
      );
    }
  }
  private async assertNoPricingOverlap(dto: CreateFeaturePricingDto, ignoreId?: string) {
    if (dto.isActive === false) return;
    const from = new Date(dto.effectiveFrom);
    const to = dto.effectiveTo ? new Date(dto.effectiveTo) : new Date('9999-12-31');
    const overlapping = await this.prisma.featurePricing.findFirst({
      where: {
        featureId: dto.featureId,
        billingUnit: dto.billingUnit,
        currency: dto.currency ?? 'INR',
        isActive: true,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
        effectiveFrom: { lte: to },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
    });
    if (overlapping) throw new ConflictException('Active feature prices cannot overlap for the same feature, billing unit, currency, and effective period.');
  }

  private pricingData(dto: CreateFeaturePricingDto) {
    const { metadata, effectiveFrom, effectiveTo, ...data } = dto;
    return {
      ...data,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    };
  }

  private packageFeatureData(
    feature: Omit<CreatePackageFeatureDto, 'featureId'> &
      Partial<Pick<CreatePackageFeatureDto, 'featureId'>>,
  ) {
    const { configuration, effectiveFrom, effectiveTo, ...data } = feature;
    if (effectiveFrom && effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom))
      throw new BadRequestException('Package Feature end date must be after its start date.');
    if (configuration && typeof configuration === 'object' && !Array.isArray(configuration) && 'loginAppCodes' in configuration) {
      const apps = (configuration as Record<string, unknown>).loginAppCodes;
      const supported = new Set(['RIDER_APP', 'CLIENT_PANEL', 'FLEET_MANAGER_APP', 'TEAM_LEADER_APP']);
      if (!Array.isArray(apps) || apps.length === 0 || apps.some((app) => typeof app !== 'string' || !supported.has(app))) {
        throw new BadRequestException('loginAppCodes must contain supported applications.');
      }
    }
    return {
      ...data,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
      includedQuantity: feature.includedQuantity,
      configuration: configuration as Prisma.InputJsonValue | undefined,
    };
  }
  private jsonSafe<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, current) =>
        typeof current === 'bigint' ? current.toString() : current,
      ),
    ) as T;
  }
  async deletePricing(id: string, actorId: string) {
    await this.exists('featurePricing', id);
    await this.prisma.featurePricing.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      actorId,
      action: 'FEATURE_PRICING_DELETED',
      entityType: 'FeaturePricing',
      entityId: id,
    });
  }

  private async exists(
    model:
      | 'oem'
      | 'vehicleCategory'
      | 'vehicleType'
      | 'feature'
      | 'package'
      | 'featurePricing'
      | 'trainingContent',
    id: string,
  ) {
    const found =
      model === 'oem'
        ? await this.prisma.oem.findUnique({ where: { id } })
        : model === 'vehicleCategory'
          ? await this.prisma.vehicleCategory.findUnique({ where: { id } })
          : model === 'vehicleType'
            ? await this.prisma.vehicleType.findUnique({ where: { id } })
            : model === 'feature'
              ? await this.prisma.feature.findUnique({ where: { id } })
              : model === 'package'
                ? await this.prisma.package.findUnique({ where: { id } })
                : model === 'featurePricing'
                  ? await this.prisma.featurePricing.findUnique({ where: { id } })
                  : await this.prisma.trainingContent.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Record not found.');
  }
  private async createWithAudit<T extends { id: string }>(
    action: string,
    entityType: string,
    actorId: string,
    create: () => Promise<T>,
  ) {
    try {
      const created = await create();
      await this.audit.record({
        actorId,
        action,
        entityType,
        entityId: created.id,
      });
      return created;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException('A record with this code already exists.');
      throw error;
    }
  }
  private async updateWithAudit<T>(
    action: string,
    entityType: string,
    id: string,
    actorId: string,
    update: () => Promise<T>,
  ) {
    try {
      const updated = await update();
      await this.audit.record({ actorId, action, entityType, entityId: id });
      return updated;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException('A record with this code already exists.');
      throw error;
    }
  }
  private async createBulk<T extends { code: string }>(
    rows: T[],
    create: (row: T) => Prisma.PrismaPromise<unknown>,
    actorId: string,
    action: string,
    entityType: string,
    label: string,
  ) {
    const failures: Array<Record<string, unknown>> = [];
    let passedRows = 0;
    for (const [index, row] of rows.entries()) {
      try {
        await create(row);
        passedRows += 1;
      } catch (error) {
        if (!this.unique(error)) throw error;
        failures.push({ ...row, row: index + 2, failure_reason: `The ${label} already exists.` });
      }
    }
    if (passedRows) {
      await this.audit.record({
        actorId,
        action,
        entityType,
        entityId: 'bulk',
        newData: { count: passedRows, codes: rows.filter((_, index) => !failures.some((failure) => failure.row === index + 2)).map((row) => row.code) },
      });
    }
    return { passedRows, failures };
  }
  private async createPlatformRows<T extends Record<string, unknown>>(
    rows: T[],
    create: (row: T) => Prisma.PrismaPromise<unknown>,
  ) {
    const failures: Array<Record<string, unknown>> = [];
    let passedRows = 0;
    for (const [index, row] of rows.entries()) {
      try { await create(row); passedRows += 1; }
      catch (error) {
        if (!this.unique(error)) throw error;
        failures.push({ ...row, row: index + 2, failure_reason: 'A record with the same code already exists.' });
      }
    }
    return { passedRows, failures };
  }
  private toBoolean(value: unknown, fallback: boolean) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new BadRequestException(`Expected true or false, received ${value}.`);
  }
  private async requireFeatureStep(id: string, requireActive = true) {
    const step = await this.prisma.featureStep.findUnique({ where: { id } });
    if (!step) throw new NotFoundException('Feature Step not found.');
    if (requireActive && !step.isActive) throw new ConflictException('An inactive Feature Step cannot be assigned.');
    return step;
  }
  private async validateFeatureStepParent(id: string, parentId: string) {
    if (id === parentId) throw new BadRequestException('A Feature Step cannot be its own parent.');
    let cursor: string | null = parentId;
    const visited = new Set<string>([id]);
    while (cursor) {
      if (visited.has(cursor)) throw new BadRequestException('A Feature Step cannot be assigned to one of its descendants.');
      visited.add(cursor);
      const step = await this.requireFeatureStep(cursor);
      cursor = step.parentId;
    }
  }
  private unique(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
  private extensionFor(mimeType: CreateOemLogoUploadIntentDto['mimeType']) {
    return mimeType === 'image/jpeg'
      ? 'jpeg'
      : mimeType === 'image/png'
        ? 'png'
        : 'webp';
  }
}
