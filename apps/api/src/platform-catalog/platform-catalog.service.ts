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
  CreatePackageFeatureDto,
  CreateFeaturePricingDto,
  CreateOemDto,
  CreatePackageDto,
  CreateVehicleCategoryDto,
  CreateVehicleTypeDto,
  UpdateFeatureDto,
  UpdateFeaturePricingDto,
  UpdateOemDto,
  UpdatePackageDto,
  UpdateVehicleCategoryDto,
  UpdateVehicleTypeDto,
} from './dto/catalog.dto.js';

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
        pricing: {
          where: { isActive: true },
          orderBy: { effectiveFrom: 'desc' },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }
  async createFeature(dto: CreateFeatureDto, actorId: string) {
    return this.createWithAudit('FEATURE_CREATED', 'Feature', actorId, () =>
      this.prisma.feature.create({ data: dto }),
    );
  }
  async updateFeature(id: string, dto: UpdateFeatureDto, actorId: string) {
    await this.exists('feature', id);
    return this.updateWithAudit('FEATURE_UPDATED', 'Feature', id, actorId, () =>
      this.prisma.feature.update({ where: { id }, data: dto }),
    );
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
    const assignedClientFeatures = await this.prisma.clientFeature.count({
      where: { featureId: id },
    });
    if (assignedClientFeatures) {
      throw new ConflictException(
        'This feature is assigned to one or more clients and cannot be deleted.',
      );
    }
    const recordedUsage = await this.prisma.featureUsage.count({
      where: { featureId: id },
    });
    if (recordedUsage) {
      throw new ConflictException(
        'This feature has recorded usage and cannot be deleted.',
      );
    }

    const removedPackageLinks = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.packageFeature.deleteMany({
        where: { featureId: id },
      });
      await tx.feature.delete({ where: { id } });
      return count;
    });
    await this.audit.record({
      actorId,
      action: 'FEATURE_DELETED',
      entityType: 'Feature',
      entityId: id,
      newData: { removedPackageLinks },
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
    const { featureIds = [], packageFeatures, ...data } = dto;
    const features = this.normalizePackageFeatures(packageFeatures, featureIds);
    await this.validatePackageFeatures(features);
    const created = await this.createWithAudit(
      'PACKAGE_CREATED',
      'Package',
      actorId,
      () =>
        this.prisma.$transaction(async (tx) => {
          return tx.package.create({
            data: {
              ...data,
              features: {
                create: features.map((feature) =>
                  this.packageFeatureData(feature),
                ),
              },
            },
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
    const { featureIds, packageFeatures, ...data } = dto;
    const features = packageFeatures
      ? this.normalizePackageFeatures(packageFeatures, [])
      : featureIds
        ? this.normalizePackageFeatures(undefined, featureIds)
        : undefined;
    if (features) await this.validatePackageFeatures(features);
    const updated = await this.updateWithAudit(
      'PACKAGE_UPDATED',
      'Package',
      id,
      actorId,
      () =>
        this.prisma.$transaction(async (tx) => {
          if (features) {
            await tx.packageFeature.deleteMany({ where: { packageId: id } });
            for (const feature of features) {
              await tx.packageFeature.create({
                data: {
                  packageId: id,
                  ...this.packageFeatureData(feature),
                },
              });
            }
          }
          return tx.package.update({
            where: { id },
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
    return this.jsonSafe(updated);
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
    await this.prisma.package.delete({ where: { id } });
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
      const optionalNumber = (value: unknown) =>
        value === undefined || value === null || value === ''
          ? undefined
          : Number(value);
      const normalized = {
        code: row.code?.trim().toUpperCase(),
        name: row.name?.trim(),
        monthlyPrice: optionalNumber(row.monthlyPrice),
        yearlyPrice: optionalNumber(row.yearlyPrice),
        currency: (row.currency ?? 'INR').toString().trim().toUpperCase(),
        maxFleets: optionalNumber(row.maxFleets),
        maxRiders: optionalNumber(row.maxRiders),
        trialDays: Number(row.trialDays ?? 0),
        displayOrder: Number(row.displayOrder ?? 0),
        isCustom: this.toBoolean(row.isCustom, false),
        isActive: this.toBoolean(row.isActive, true),
        description: row.description?.trim() || undefined,
      };
      const integerFields = [
        normalized.maxFleets,
        normalized.maxRiders,
        normalized.trialDays,
        normalized.displayOrder,
      ];
      const monetaryFields = [normalized.monthlyPrice, normalized.yearlyPrice];
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
        include: { feature: true, tiers: { orderBy: { tierOrder: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
      })
      .then((pricing) => this.jsonSafe(pricing));
  }
  async createPricing(dto: CreateFeaturePricingDto, actorId: string) {
    this.validatePricing(dto);
    await this.exists('feature', dto.featureId);
    const created = await this.createWithAudit(
      'FEATURE_PRICING_CREATED',
      'FeaturePricing',
      actorId,
      () =>
        this.prisma.featurePricing.create({
          data: this.pricingData(dto),
          include: { feature: true, tiers: { orderBy: { tierOrder: 'asc' } } },
        }),
    );
    return this.jsonSafe(created);
  }
  async updatePricing(
    id: string,
    dto: UpdateFeaturePricingDto,
    actorId: string,
  ) {
    await this.exists('featurePricing', id);
    this.validatePricing(dto);
    await this.exists('feature', dto.featureId);
    if (dto.tiers) {
      await this.prisma.featurePricingTier.deleteMany({
        where: { featurePricingId: id },
      });
    }
    const updated = await this.updateWithAudit(
      'FEATURE_PRICING_UPDATED',
      'FeaturePricing',
      id,
      actorId,
      () =>
        this.prisma.featurePricing.update({
          where: { id },
          data: this.pricingData(dto),
          include: { feature: true, tiers: { orderBy: { tierOrder: 'asc' } } },
        }),
    );
    return this.jsonSafe(updated);
  }

  private validatePricing(dto: CreateFeaturePricingDto) {
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : undefined;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException(
        'Effective end date must be on or after the effective start date.',
      );
    }
    if (
      dto.minimumCharge !== undefined &&
      dto.maximumCharge !== undefined &&
      dto.minimumCharge > dto.maximumCharge
    ) {
      throw new BadRequestException(
        'Maximum charge must be greater than or equal to minimum charge.',
      );
    }
    const tierOrders = new Set<number>();
    for (const tier of dto.tiers ?? []) {
      if (tierOrders.has(tier.tierOrder)) {
        throw new BadRequestException('Pricing tier order must be unique.');
      }
      tierOrders.add(tier.tierOrder);
      if (
        tier.toQuantity !== undefined &&
        tier.toQuantity < tier.fromQuantity
      ) {
        throw new BadRequestException(
          'Tier end quantity must be greater than or equal to its start quantity.',
        );
      }
    }
  }

  private pricingData(dto: CreateFeaturePricingDto) {
    const { metadata, tiers, effectiveFrom, effectiveTo, ...data } = dto;
    return {
      ...data,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      tiers: tiers
        ? {
            create: tiers.map((tier) => ({
              ...tier,
              fromQuantity: BigInt(tier.fromQuantity),
              toQuantity:
                tier.toQuantity === undefined
                  ? undefined
                  : BigInt(tier.toQuantity),
            })),
          }
        : undefined,
    };
  }

  private normalizePackageFeatures(
    packageFeatures: CreatePackageFeatureDto[] | undefined,
    featureIds: string[],
  ) {
    return (
      packageFeatures ??
      featureIds.map((featureId, displayOrder) => ({
        featureId,
        unlimitedUsage: true,
        displayOrder,
      }))
    );
  }

  private async validatePackageFeatures(features: CreatePackageFeatureDto[]) {
    const seen = new Set<string>();
    for (const feature of features) {
      if (seen.has(feature.featureId)) {
        throw new ConflictException(
          'A Feature can only be added once per Package.',
        );
      }
      seen.add(feature.featureId);
      await this.exists('feature', feature.featureId);
    }
  }

  private packageFeatureData(feature: CreatePackageFeatureDto) {
    const { configuration, ...data } = feature;
    return {
      ...data,
      includedQuantity:
        feature.includedQuantity === undefined
          ? undefined
          : BigInt(feature.includedQuantity),
      usageLimit:
        feature.usageLimit === undefined
          ? undefined
          : BigInt(feature.usageLimit),
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
    await this.prisma.featurePricing.delete({ where: { id } });
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
