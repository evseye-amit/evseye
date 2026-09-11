import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateFeatureDto,
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
  ) {}

  dashboard() {
    return Promise.all([
      this.prisma.tenant.count(),
      this.prisma.fleet.count(),
      this.prisma.rider.count(),
      this.prisma.package.count({ where: { status: 'ACTIVE' } }),
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

  listFeatures() {
    return this.prisma.feature.findMany({
      include: {
        pricing: {
          where: { isActive: true },
          orderBy: { effectiveFrom: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
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

  listPackages() {
    return this.prisma.package.findMany({
      include: {
        features: { include: { feature: true } },
        _count: { select: { subscriptions: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
  async createPackage(dto: CreatePackageDto, actorId: string) {
    const { featureIds = [], ...data } = dto;
    return this.createWithAudit('PACKAGE_CREATED', 'Package', actorId, () =>
      this.prisma.package.create({
        data: {
          ...data,
          features: {
            create: featureIds.map((featureId) => ({
              featureId,
              unlimitedUsage: true,
            })),
          },
        },
        include: { features: { include: { feature: true } } },
      }),
    );
  }
  async updatePackage(id: string, dto: UpdatePackageDto, actorId: string) {
    await this.exists('package', id);
    const { featureIds, ...data } = dto;
    return this.updateWithAudit('PACKAGE_UPDATED', 'Package', id, actorId, () =>
      this.prisma.$transaction(async (tx) => {
        if (featureIds) {
          await tx.packageFeature.deleteMany({ where: { packageId: id } });
          await tx.packageFeature.createMany({
            data: featureIds.map((featureId) => ({
              packageId: id,
              featureId,
              unlimitedUsage: true,
            })),
          });
        }
        return tx.package.update({
          where: { id },
          data,
          include: { features: { include: { feature: true } } },
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
      include: { feature: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async createPricing(dto: CreateFeaturePricingDto, actorId: string) {
    return this.createWithAudit(
      'FEATURE_PRICING_CREATED',
      'FeaturePricing',
      actorId,
      () =>
        this.prisma.featurePricing.create({
          data: dto,
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
    return this.updateWithAudit(
      'FEATURE_PRICING_UPDATED',
      'FeaturePricing',
      id,
      actorId,
      () =>
        this.prisma.featurePricing.update({
          where: { id },
          data: dto,
          include: { feature: true },
        }),
    );
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
}
