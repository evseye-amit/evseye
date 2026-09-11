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
  MasterRecordStatus,
  OemType,
  Prisma,
} from '@prisma/client';
import type {
  BulkCreateOemsDto,
  BulkCreateFeaturesDto,
  CompleteOemLogoUploadDto,
  CreateOemLogoUploadIntentDto,
  CreateFeatureDto,
  CreatePackageFeatureDto,
  CreateFeaturePricingDto,
  CreateOemDto,
  CreatePackageDto,
  UpdateFeatureDto,
  UpdateFeaturePricingDto,
  UpdateOemDto,
  UpdatePackageDto,
} from './dto/catalog.dto.js';

@Injectable()
export class PlatformCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  dashboard() {
    return Promise.all([
      this.prisma.tenant.count(),
      this.prisma.fleet.count(),
      this.prisma.rider.count(),
      this.prisma.package.count({ where: { isActive: true } }),
      this.prisma.oem.count({ where: { status: 'ACTIVE' } }),
    ]).then(([clients, fleets, riders, packages, oems]) => ({
      clients,
      fleets,
      riders,
      packages,
      oems,
    }));
  }

  listOems() {
    return this.prisma.oem.findMany({
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
    });
  }
  async createOem(dto: CreateOemDto, actorId: string) {
    return this.createWithAudit('OEM_CREATED', 'OEM', actorId, () =>
      this.prisma.oem.create({ data: dto }),
    );
  }
  async updateOem(id: string, dto: UpdateOemDto, actorId: string) {
    await this.exists('oem', id);
    return this.updateWithAudit('OEM_UPDATED', 'OEM', id, actorId, () =>
      this.prisma.oem.update({ where: { id }, data: dto }),
    );
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
    return updated;
  }
  async bulkCreateOems(dto: BulkCreateOemsDto, actorId: string) {
    const validTypes = new Set(Object.values(OemType));
    const validStatuses = new Set(Object.values(MasterRecordStatus));
    const codes = new Set<string>();
    const rows = dto.rows.map((row, index) => {
      const normalized = {
        ...row,
        code: row.code?.trim().toUpperCase(),
        name: row.name?.trim(),
        displayName: row.displayName?.trim(),
        type: row.type?.trim().toUpperCase() as OemType,
        status: row.status?.trim().toUpperCase() as MasterRecordStatus,
      };
      if (
        !normalized.code ||
        !/^[A-Z0-9_-]{1,40}$/.test(normalized.code) ||
        !normalized.name ||
        !normalized.displayName ||
        !validTypes.has(normalized.type) ||
        !validStatuses.has(normalized.status)
      )
        throw new ConflictException(
          `Row ${index + 2} is invalid. Check code, name, display name, type, and status.`,
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
    await this.prisma.feature.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'FEATURE_DELETED',
      entityType: 'Feature',
      entityId: id,
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
    return this.prisma.package.findMany({
      include: {
        features: {
          include: {
            feature: true,
            pricing: { include: { featurePricing: true } },
          },
          orderBy: { displayOrder: 'asc' },
        },
        _count: { select: { subscriptions: true } },
      },
      orderBy: [
        { isDefault: 'desc' },
        { displayOrder: 'asc' },
        { name: 'asc' },
      ],
    });
  }
  async createPackage(dto: CreatePackageDto, actorId: string) {
    const { featureIds = [], packageFeatures, ...data } = dto;
    const features = this.normalizePackageFeatures(packageFeatures, featureIds);
    await this.validatePackageFeatures(features);
    return this.createWithAudit('PACKAGE_CREATED', 'Package', actorId, () =>
      this.prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.package.updateMany({
            where: { isDefault: true },
            data: { isDefault: false, updatedById: actorId },
          });
        }
        return tx.package.create({
          data: {
            ...data,
            createdById: actorId,
            updatedById: actorId,
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
                pricing: { include: { featurePricing: true } },
              },
            },
          },
        });
      }),
    );
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
    return this.updateWithAudit('PACKAGE_UPDATED', 'Package', id, actorId, () =>
      this.prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.package.updateMany({
            where: { isDefault: true, id: { not: id } },
            data: { isDefault: false, updatedById: actorId },
          });
        }
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
          data: { ...data, updatedById: actorId },
          include: {
            features: {
              include: {
                feature: true,
                pricing: { include: { featurePricing: true } },
              },
            },
          },
        });
      }),
    );
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

  listPricing() {
    return this.prisma.featurePricing.findMany({
      include: { feature: true, tiers: { orderBy: { tierOrder: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async createPricing(dto: CreateFeaturePricingDto, actorId: string) {
    this.validatePricing(dto);
    await this.exists('feature', dto.featureId);
    return this.createWithAudit(
      'FEATURE_PRICING_CREATED',
      'FeaturePricing',
      actorId,
      () =>
        this.prisma.featurePricing.create({
          data: this.pricingData(dto),
          include: { feature: true },
        }),
    );
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
    return this.updateWithAudit(
      'FEATURE_PRICING_UPDATED',
      'FeaturePricing',
      id,
      actorId,
      () =>
        this.prisma.featurePricing.update({
          where: { id },
          data: this.pricingData(dto),
          include: { feature: true },
        }),
    );
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
    const { metadata, tiers, ...data } = dto;
    return {
      ...data,
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
      for (const pricing of feature.pricing ?? []) {
        if (
          pricing.effectiveTo &&
          pricing.effectiveTo < pricing.effectiveFrom
        ) {
          throw new BadRequestException(
            'Package Feature Pricing end date must be on or after its start date.',
          );
        }
        if (
          pricing.minimumCharge !== undefined &&
          pricing.maximumCharge !== undefined &&
          pricing.minimumCharge > pricing.maximumCharge
        ) {
          throw new BadRequestException(
            'Package Feature Pricing maximum charge must be greater than or equal to minimum charge.',
          );
        }
        if (pricing.featurePricingId) {
          const featurePricing = await this.prisma.featurePricing.findUnique({
            where: { id: pricing.featurePricingId },
            select: { featureId: true },
          });
          if (
            !featurePricing ||
            featurePricing.featureId !== feature.featureId
          ) {
            throw new BadRequestException(
              'The selected Feature Price must belong to the Package Feature.',
            );
          }
        }
      }
    }
  }

  private packageFeatureData(feature: CreatePackageFeatureDto) {
    const { pricing, configuration, ...data } = feature;
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
      pricing: pricing?.length
        ? {
            create: pricing.map((item) => this.packageFeaturePricingData(item)),
          }
        : undefined,
    };
  }

  private packageFeaturePricingData(
    pricing: NonNullable<CreatePackageFeatureDto['pricing']>[number],
    packageFeatureId?: string,
  ) {
    return {
      ...(packageFeatureId ? { packageFeatureId } : {}),
      ...pricing,
      includedQuantity: BigInt(pricing.includedQuantity ?? 0),
    };
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
    model: 'oem' | 'feature' | 'package' | 'featurePricing',
    id: string,
  ) {
    const found =
      model === 'oem'
        ? await this.prisma.oem.findUnique({ where: { id } })
        : model === 'feature'
          ? await this.prisma.feature.findUnique({ where: { id } })
          : model === 'package'
            ? await this.prisma.package.findUnique({ where: { id } })
            : await this.prisma.featurePricing.findUnique({ where: { id } });
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
