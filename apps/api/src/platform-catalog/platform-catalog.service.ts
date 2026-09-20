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
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../media/storage/storage-provider.interface.js';
import {
  FeatureBillingUnit,
  FeatureCategory,
  FeatureType,
  EnergyType,
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
  CreateFeatureStepDto,
  CreatePackageFeatureDto,
  CreatePackageFeatureAssignmentDto,
  CreateFeaturePricingDto,
  CreateOemDto,
  CreatePackageDto,
  CreateVehicleCategoryDto,
  CreateVehicleTypeDto,
  UpdateFeatureDto,
  UpdateFeatureStepDto,
  UpdateFeaturePricingDto,
  UpdateOemDto,
  UpdatePackageDto,
  UpdatePackageFeatureDto,
  UpdateVehicleCategoryDto,
  UpdateVehicleTypeDto,
} from './dto/catalog.dto.js';

const PACKAGE_UNLIMITED_LIMIT = 2_147_483_647;

@Injectable()
export class PlatformCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

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
    await this.exists('oem', id);
    const oem = await this.updateWithAudit('OEM_UPDATED', 'OEM', id, actorId, () =>
      this.prisma.oem.update({ where: { id }, data: dto }),
    );
    return this.serializeOem(oem);
  }
  async deleteOem(id: string, actorId: string) {
    await this.exists('oem', id);
    await this.prisma.oem.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'OEM_DELETED',
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
    try {
      await this.prisma.$transaction(
        rows.map((row) => this.prisma.oem.create({ data: row })),
      );
      await this.audit.record({
        actorId,
        action: 'OEM_BULK_CREATED',
        entityType: 'OEM',
        entityId: 'bulk',
        newData: { count: rows.length, codes: rows.map((row) => row.code) },
      });
      return { created: rows.length };
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'The upload contains an OEM code that already exists. No OEMs were imported.',
        );
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
    await this.exists('vehicleCategory', id);
    return this.updateWithAudit(
      'VEHICLE_CATEGORY_UPDATED',
      'VehicleCategory',
      id,
      actorId,
      () =>
        this.prisma.vehicleCategory.update({
          where: { id },
          data: dto,
        }),
    );
  }
  async deleteVehicleCategory(id: string, actorId: string) {
    await this.exists('vehicleCategory', id);
    await this.prisma.vehicleCategory.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'VEHICLE_CATEGORY_DELETED',
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
    await this.createBulk(
      rows,
      (row) => this.prisma.vehicleCategory.create({ data: row }),
      actorId,
      'VEHICLE_CATEGORY_BULK_CREATED',
      'VehicleCategory',
      'vehicle category code',
    );
    return { created: rows.length };
  }
  listVehicleTypes() {
    return this.prisma.vehicleType.findMany({
      include: { category: true },
      orderBy: [{ category: { displayOrder: 'asc' } }, { name: 'asc' }],
    });
  }
  async createVehicleType(dto: CreateVehicleTypeDto, actorId: string) {
    await this.exists('vehicleCategory', dto.categoryId);
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
    await this.exists('vehicleType', id);
    await this.exists('vehicleCategory', dto.categoryId);
    return this.updateWithAudit(
      'VEHICLE_TYPE_UPDATED',
      'VehicleType',
      id,
      actorId,
      () =>
        this.prisma.vehicleType.update({
          where: { id },
          data: dto,
          include: { category: true },
        }),
    );
  }
  async deleteVehicleType(id: string, actorId: string) {
    await this.exists('vehicleType', id);
    await this.prisma.vehicleType.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'VEHICLE_TYPE_DELETED',
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
    await this.createBulk(
      rows.map(({ categoryCode, ...row }) => ({
        ...row,
        categoryId: categoryIdByCode.get(categoryCode)!,
        energyType: row.energyType as EnergyType,
        usageType: row.usageType as VehicleUsageType | undefined,
        status: row.status as MasterRecordStatus,
      })),
      (row) => this.prisma.vehicleType.create({ data: row }),
      actorId,
      'VEHICLE_TYPE_BULK_CREATED',
      'VehicleType',
      'vehicle type code',
    );
    return { created: rows.length };
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
    const { configuration, featureStepId, ...data } = dto;
    if (featureStepId) await this.requireFeatureStep(featureStepId);
    return this.createWithAudit('FEATURE_CREATED', 'Feature', actorId, () =>
      this.prisma.feature.create({
        data: {
          ...data,
          ...(featureStepId ? { featureStepId } : {}),
          ...(configuration !== undefined
            ? { configuration: configuration as Prisma.InputJsonValue }
            : {}),
        },
      }),
    );
  }
  async updateFeature(id: string, dto: UpdateFeatureDto, actorId: string) {
    await this.exists('feature', id);
    const { configuration, featureStepId, ...data } = dto;
    if (featureStepId) await this.requireFeatureStep(featureStepId);
    return this.updateWithAudit('FEATURE_UPDATED', 'Feature', id, actorId, () =>
      this.prisma.feature.update({
        where: { id },
        data: {
          ...data,
          ...(featureStepId !== undefined ? { featureStepId } : {}),
          ...(configuration !== undefined
            ? { configuration: configuration as Prisma.InputJsonValue }
            : {}),
        },
      }),
    );
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
    return this.createWithAudit('FEATURE_STEP_CREATED', 'FeatureStep', actorId, () =>
      this.prisma.featureStep.create({ data: dto }),
    );
  }
  async updateFeatureStep(id: string, dto: UpdateFeatureStepDto, actorId: string) {
    await this.requireFeatureStep(id, false);
    if (dto.parentId) await this.validateFeatureStepParent(id, dto.parentId);
    return this.updateWithAudit('FEATURE_STEP_UPDATED', 'FeatureStep', id, actorId, () =>
      this.prisma.featureStep.update({ where: { id }, data: dto }),
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
      return normalized;
    });
    try {
      await this.prisma.$transaction(
        rows.map((row) => this.prisma.feature.create({ data: row })),
      );
      await this.audit.record({
        actorId,
        action: 'FEATURE_BULK_CREATED',
        entityType: 'Feature',
        entityId: 'bulk',
        newData: { count: rows.length, codes: rows.map((row) => row.code) },
      });
      return { created: rows.length };
    } catch (error) {
      if (this.unique(error)) {
        throw new ConflictException(
          'The upload contains a feature code that already exists. No features were imported.',
        );
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
    await this.exists('package', dto.packageId);
    await this.exists('feature', dto.featureId);
    const { packageId, featureId, ...feature } = dto;
    try {
      const created = await this.createWithAudit(
        'PACKAGE_FEATURE_CREATED',
        'PackageFeature',
        actorId,
        () =>
          this.prisma.packageFeature.create({
            data: { packageId, featureId, ...this.packageFeatureData(feature) },
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
    const existing = await this.prisma.packageFeature.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Package Feature not found.');
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
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const row of rows) await tx.package.create({ data: row });
      });
      await this.audit.record({
        actorId,
        action: 'PACKAGE_BULK_CREATED',
        entityType: 'Package',
        entityId: 'bulk',
        newData: { count: rows.length, codes: rows.map((row) => row.code) },
      });
      return { created: rows.length };
    } catch (error) {
      if (this.unique(error)) {
        throw new ConflictException(
          'The upload contains a package code that already exists. No packages were imported.',
        );
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
    const { configuration, ...data } = feature;
    return {
      ...data,
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
      | 'featurePricing',
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
                : await this.prisma.featurePricing.findUnique({
                    where: { id },
                  });
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
    try {
      await this.prisma.$transaction(rows.map((row) => create(row)));
      await this.audit.record({
        actorId,
        action,
        entityType,
        entityId: 'bulk',
        newData: { count: rows.length, codes: rows.map((row) => row.code) },
      });
    } catch (error) {
      if (this.unique(error)) {
        throw new ConflictException(
          `The upload contains a ${label} that already exists. No records were imported.`,
        );
      }
      throw error;
    }
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
