import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ClientAddressType,
  ClientContactRole,
  ClientDocumentType,
  ClientStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { assertUserMobileAvailable, normalizeIndianMobile, USER_MOBILE_CONFLICT_MESSAGE } from '../common/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ClientLogoUploadDto, CompleteClientLogoDto } from './dto/client-logo.dto.js';
import type {
  CreateClientFeatureDto,
  UpdateClientFeatureDto,
} from './dto/client-feature.dto.js';
import type {
  CreateClientFeaturePricingDto,
  UpdateClientFeaturePricingDto,
} from './dto/client-feature-pricing.dto.js';
import type { CreateFeatureUsageDto } from './dto/feature-usage.dto.js';
import type { CreateClientDto } from './dto/create-client.dto.js';
import type {
  CreateClientDocumentUploadIntentDto,
  CreateClientDraftDto,
  UpdateClientAgreementDto,
  UpdateClientBillingDto,
  UpdateClientBusinessDetailsDto,
  UpdateClientContactsAndAddressDto,
  UpdateClientOperationsDto,
  UpdateClientPackageSelectionDto,
} from './dto/client-onboarding-steps.dto.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../media/storage/storage-provider.interface.js';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async clientBranding(clientId?: string, companyCode?: string) {
    if (!clientId && (!companyCode || !/^[a-z0-9-]{1,80}$/.test(companyCode))) return null;
    const client = await this.prisma.client.findFirst({
      where: { ...(clientId ? { id: clientId } : { companyCode }), isActive: true },
      select: { name: true, businessProfile: { select: { logoObjectKey: true } } },
    });
    if (!client) return null;
    return { name: client.name, logoUrl: client.businessProfile?.logoObjectKey ? await this.storage.createDownloadUrl(client.businessProfile.logoObjectKey) : null };
  }

  async createClientLogoUpload(clientId: string, dto: ClientLogoUploadDto) {
    await this.requireEditableClient(clientId, dto.approvalEmailReference);
    const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    if (!extensions[dto.mimeType] || dto.sizeBytes <= 0 || dto.sizeBytes > 2 * 1024 * 1024)
      throw new BadRequestException('Choose a PNG, JPEG, or WebP logo up to 2 MB.');
    const objectKey = `clients/${clientId}/logo/${randomUUID()}.${extensions[dto.mimeType]}`;
    return { objectKey, uploadUrl: await this.storage.createUploadUrl({ objectKey, mimeType: dto.mimeType, sizeBytes: dto.sizeBytes }) };
  }

  async completeClientLogoUpload(clientId: string, dto: CompleteClientLogoDto, actorId: string) {
    const editable = await this.requireEditableClient(clientId, dto.approvalEmailReference);
    const prefix = `clients/${clientId}/logo/`;
    if (!dto.objectKey.startsWith(prefix) || !/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(dto.objectKey.slice(prefix.length)))
      throw new BadRequestException('Invalid client logo upload.');
    await this.storage.assertObjectExists(dto.objectKey);
    await this.prisma.clientBusinessProfile.update({ where: { clientId }, data: { logoObjectKey: dto.objectKey } });
    await this.audit.record({ actorId, action: 'CLIENT_LOGO_UPDATED', entityType: 'Client', entityId: clientId, newData: { logoObjectKey: dto.objectKey, ...this.activeEditAuditData(editable, dto.approvalEmailReference) } });
    return { logoUrl: await this.storage.createDownloadUrl(dto.objectKey) };
  }

  listClients() {
    return this.prisma.client.findMany({
      include: {
        businessProfile: true,
        _count: {
          select: { users: true, riders: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async recordFeatureUsage(
    clientId: string,
    dto: CreateFeatureUsageDto,
    actorId: string,
  ) {
    const usageTimestamp = new Date(dto.usageTimestamp);
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: dto.subscriptionId, clientId, status: 'ACTIVE' },
      include: {
        package: {
          include: {
            features: {
              where: { featureId: dto.featureId, enabled: true },
            },
          },
        },
        features: {
          where: {
            featureId: dto.featureId,
            enabled: true,
            effectiveFrom: { lte: usageTimestamp },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: usageTimestamp } },
            ],
          },
        },
      },
    });
    if (!subscription)
      throw new NotFoundException('Active client subscription not found.');
    if (
      subscription.package.features.length === 0 &&
      subscription.features.length === 0
    ) {
      throw new UnprocessableEntityException(
        'This feature is not enabled for the client subscription.',
      );
    }
    await this.requireActiveFeature(dto.featureId);
    const usage = await this.prisma.featureUsage.create({
      data: {
        clientId,
        subscriptionId: dto.subscriptionId,
        featureId: dto.featureId,
        usageReference: dto.usageReference,
        quantity: dto.quantity ?? 1,
        usageTimestamp,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
      include: { feature: true },
    });
    await this.audit.record({
      clientId: clientId,
      actorId,
      action: 'FEATURE_USAGE_RECORDED',
      entityType: 'FeatureUsage',
      entityId: usage.id,
      newData: {
        subscriptionId: dto.subscriptionId,
        featureId: dto.featureId,
        quantity: usage.quantity.toString(),
        usageReference: usage.usageReference,
      },
    });
    return usage;
  }

  async billingPreview(
    clientId: string,
    subscriptionId: string,
    from: string,
    to: string,
  ) {
    const periodStart = new Date(from);
    const periodEnd = new Date(to);
    if (
      Number.isNaN(periodStart.valueOf()) ||
      Number.isNaN(periodEnd.valueOf())
    ) {
      throw new UnprocessableEntityException(
        'A valid billing period is required.',
      );
    }
    if (periodEnd < periodStart) {
      throw new UnprocessableEntityException(
        'Billing period end cannot be before start.',
      );
    }
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: subscriptionId, clientId },
      include: {
        package: {
          include: {
            features: {
              where: { enabled: true },
              include: { feature: true },
            },
          },
        },
        features: {
          where: {
            enabled: true,
            effectiveFrom: { lte: periodEnd },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
          },
          include: {
            feature: true,
            pricing: {
              where: {
                effectiveFrom: { lte: periodEnd },
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gte: periodStart } },
                ],
              },
              orderBy: { effectiveFrom: 'desc' },
            },
          },
        },
      },
    });
    if (!subscription)
      throw new NotFoundException('Client subscription not found.');
    const usage = await this.prisma.featureUsage.findMany({
      where: {
        clientId,
        subscriptionId,
        usageTimestamp: { gte: periodStart, lte: periodEnd },
      },
      include: { feature: true },
      orderBy: { usageTimestamp: 'asc' },
    });
    const featureIds = [...new Set(usage.map((item) => item.featureId))];
    const masterPricing = featureIds.length
      ? await this.prisma.featurePricing.findMany({
          where: {
            featureId: { in: featureIds },
            isActive: true,
            effectiveFrom: { lte: periodEnd },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        })
      : [];
    const usageByFeature = new Map<string, Prisma.Decimal>();
    for (const item of usage) {
      usageByFeature.set(
        item.featureId,
        (usageByFeature.get(item.featureId) ?? new Prisma.Decimal(0)).plus(
          item.quantity,
        ),
      );
    }
    const lines = [...usageByFeature.entries()].map(([featureId, quantity]) => {
      const packageFeature = subscription.package.features.find(
        (item) => item.featureId === featureId,
      );
      const clientFeature = subscription.features.find(
        (item) => item.featureId === featureId,
      );
      const includedUnlimited = packageFeature
        ? packageFeature.unlimitedUsage
        : (clientFeature?.unlimitedUsage ?? false);
      const includedQuantity = includedUnlimited
        ? quantity
        : new Prisma.Decimal(
            packageFeature?.includedQuantity?.toString() ??
              clientFeature?.includedQuantity.toString() ??
              '0',
          );
      const billableQuantity = includedUnlimited
        ? new Prisma.Decimal(0)
        : Prisma.Decimal.max(
            quantity.minus(includedQuantity),
            new Prisma.Decimal(0),
          );
      const negotiatedPricing = clientFeature?.pricing[0];
      const catalogPricing = masterPricing.find(
        (item) => item.featureId === featureId,
      );
      if (
        billableQuantity.greaterThan(0) &&
        !negotiatedPricing &&
        !catalogPricing
      ) {
        throw new UnprocessableEntityException(
          `No active price exists for feature ${featureId}.`,
        );
      }
      const unitPrice =
        negotiatedPricing?.finalUnitPrice ??
        catalogPricing?.unitPrice ??
        new Prisma.Decimal(0);
      return {
        featureId,
        featureName:
          packageFeature?.feature.name ??
          clientFeature?.feature.name ??
          usage.find((item) => item.featureId === featureId)?.feature.name,
        totalQuantity: quantity,
        includedQuantity: includedUnlimited ? null : includedQuantity,
        unlimitedUsage: includedUnlimited,
        billableQuantity,
        unitPrice,
        amount: billableQuantity.mul(unitPrice),
        priceSource: negotiatedPricing
          ? 'CLIENT_FEATURE_PRICING'
          : 'FEATURE_PRICING',
      };
    });
    const overageTotal = lines.reduce(
      (total, line) => total.plus(line.amount),
      new Prisma.Decimal(0),
    );
    return {
      subscriptionId,
      clientId,
      period: { from: periodStart, to: periodEnd },
      currency: subscription.currency,
      package: {
        packageId: subscription.packageId,
        packageName: subscription.package.name,
        listPrice: subscription.listPrice,
        finalPrice: subscription.finalPackagePrice,
      },
      featureOverages: lines,
      totals: {
        package: subscription.finalPackagePrice,
        overage: overageTotal,
        subtotal: subscription.finalPackagePrice.plus(overageTotal),
      },
    };
  }

  async listClientFeatures(clientId: string) {
    await this.requireClient(clientId);
    return this.prisma.clientFeature.findMany({
      where: { clientId },
      include: {
        feature: true,
        subscription: { include: { package: true } },
        pricing: { orderBy: { effectiveFrom: 'desc' } },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { feature: { name: 'asc' } }],
    });
  }

  /**
   * Returns the commercial entitlement snapshot used by the Super Admin
   * workspace. Package inclusions and client-specific add-ons deliberately
   * remain separate: assigning an add-on must never mutate the package master.
   */
  async clientEntitlements(clientId: string) {
    const client = await this.clientDetail(clientId);
    const subscription = client.subscriptions.find(
      (item) => item.status === 'ACTIVE',
    );

    if (!subscription) {
      return {
        client,
        subscription: null,
        packageFeatures: [],
        clientFeatures: [],
      };
    }

    const [packageFeatures, clientFeatures] = await Promise.all([
      this.prisma.packageFeature.findMany({
        where: { packageId: subscription.packageId, enabled: true },
        include: {
          feature: {
            include: {
              pricing: {
                where: {
                  isActive: true,
                  effectiveFrom: { lte: new Date() },
                  OR: [
                    { effectiveTo: null },
                    { effectiveTo: { gte: new Date() } },
                  ],
                },
                orderBy: { effectiveFrom: 'desc' },
              },
            },
          },
        },
        orderBy: [{ displayOrder: 'asc' }, { feature: { name: 'asc' } }],
      }),
      this.prisma.clientFeature.findMany({
        where: { clientId, subscriptionId: subscription.id, enabled: true },
        include: {
          feature: {
            include: {
              pricing: {
                where: { isActive: true },
                orderBy: { effectiveFrom: 'desc' },
              },
            },
          },
          pricing: {
            include: { featurePricing: true },
            orderBy: { effectiveFrom: 'desc' },
          },
        },
        orderBy: [{ effectiveFrom: 'asc' }, { feature: { name: 'asc' } }],
      }),
    ]);

    return { client, subscription, packageFeatures, clientFeatures };
  }

  async listClientFeatureUsage(clientId: string) {
    await this.requireClient(clientId);
    return this.prisma.featureUsage.findMany({
      where: { clientId },
      include: { feature: true, subscription: { include: { package: true } } },
      orderBy: { usageTimestamp: 'desc' },
      take: 250,
    });
  }

  async listClientFeaturePricing(clientId: string, clientFeatureId: string) {
    await this.requireClientFeature(clientId, clientFeatureId);
    return this.prisma.clientFeaturePricing.findMany({
      where: { clientFeatureId },
      include: { featurePricing: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async createClientFeaturePricing(
    clientId: string,
    clientFeatureId: string,
    dto: CreateClientFeaturePricingDto,
    actorId: string,
  ) {
    const clientFeature = await this.requireClientFeature(
      clientId,
      clientFeatureId,
    );
    const featurePricing = await this.requireFeaturePricing(
      clientFeature.featureId,
      dto.featurePricingId,
    );
    this.validateFeatureWindow(dto.effectiveFrom, dto.effectiveTo);
    const finalUnitPrice = this.discountedPrice(
      featurePricing.unitPrice,
      dto.discountType,
      dto.discountValue,
    );
    const created = await this.prisma.clientFeaturePricing.create({
      data: {
        clientFeatureId,
        featurePricingId: featurePricing.id,
        currency: featurePricing.currency,
        listUnitPrice: featurePricing.unitPrice,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        finalUnitPrice,
        setupFee: dto.setupFee ?? 0,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        reason: dto.reason,
        approvedBy: actorId,
      },
      include: { featurePricing: true },
    });
    await this.audit.record({
      clientId: clientId,
      actorId,
      action: 'CLIENT_FEATURE_PRICING_CREATED',
      entityType: 'ClientFeaturePricing',
      entityId: created.id,
      newData: {
        clientFeatureId,
        featurePricingId: featurePricing.id,
        finalUnitPrice: created.finalUnitPrice.toString(),
      },
    });
    return created;
  }

  async updateClientFeaturePricing(
    clientId: string,
    clientFeatureId: string,
    clientFeaturePricingId: string,
    dto: UpdateClientFeaturePricingDto,
    actorId: string,
  ) {
    await this.requireClientFeature(clientId, clientFeatureId);
    const current = await this.prisma.clientFeaturePricing.findFirst({
      where: { id: clientFeaturePricingId, clientFeatureId },
      include: { featurePricing: true },
    });
    if (!current)
      throw new NotFoundException('Client feature pricing not found.');
    this.validateFeatureWindow(
      dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      dto.effectiveTo ?? current.effectiveTo?.toISOString(),
    );
    const discountType = dto.discountType ?? current.discountType ?? undefined;
    const discountValue =
      dto.discountValue === undefined
        ? (current.discountValue?.toNumber() ?? undefined)
        : dto.discountValue;
    const finalUnitPrice = this.discountedPrice(
      current.listUnitPrice,
      discountType,
      discountValue,
    );
    const { effectiveFrom, effectiveTo, ...data } = dto;
    const updated = await this.prisma.clientFeaturePricing.update({
      where: { id: clientFeaturePricingId },
      data: {
        ...data,
        finalUnitPrice,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
      },
      include: { featurePricing: true },
    });
    await this.audit.record({
      clientId: clientId,
      actorId,
      action: 'CLIENT_FEATURE_PRICING_UPDATED',
      entityType: 'ClientFeaturePricing',
      entityId: clientFeaturePricingId,
      previousData: { finalUnitPrice: current.finalUnitPrice.toString() },
      newData: { finalUnitPrice: updated.finalUnitPrice.toString() },
    });
    return updated;
  }

  async deleteClientFeaturePricing(
    clientId: string,
    clientFeatureId: string,
    clientFeaturePricingId: string,
    actorId: string,
  ) {
    await this.requireClientFeature(clientId, clientFeatureId);
    const current = await this.prisma.clientFeaturePricing.findFirst({
      where: { id: clientFeaturePricingId, clientFeatureId },
    });
    if (!current)
      throw new NotFoundException('Client feature pricing not found.');
    await this.prisma.clientFeaturePricing.delete({
      where: { id: clientFeaturePricingId },
    });
    await this.audit.record({
      clientId: clientId,
      actorId,
      action: 'CLIENT_FEATURE_PRICING_REMOVED',
      entityType: 'ClientFeaturePricing',
      entityId: clientFeaturePricingId,
      previousData: { featurePricingId: current.featurePricingId },
    });
  }

  async createClientFeature(
    clientId: string,
    dto: CreateClientFeatureDto,
    actorId: string,
  ) {
    const subscription = await this.requireClientSubscription(
      clientId,
      dto.subscriptionId,
    );
    await this.requireActiveFeature(dto.featureId);
    this.validateFeatureWindow(dto.effectiveFrom, dto.effectiveTo);
    const packageFeature = await this.prisma.packageFeature.findFirst({
      where: {
        packageId: subscription.packageId,
        featureId: dto.featureId,
        enabled: true,
      },
    });
    try {
      const created = await this.prisma.clientFeature.create({
        data: {
          clientId,
          subscriptionId: dto.subscriptionId,
          featureId: dto.featureId,
          source: dto.source ?? (packageFeature ? 'CUSTOM' : 'ADD_ON'),
          enabled: dto.enabled ?? true,
          includedQuantity: dto.includedQuantity ?? 0,
          usageLimit: dto.usageLimit,
          unlimitedUsage: dto.unlimitedUsage ?? false,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
          configuration: dto.configuration as Prisma.InputJsonValue | undefined,
        },
        include: {
          feature: true,
          subscription: { include: { package: true } },
        },
      });
      await this.audit.record({
        clientId: clientId,
        actorId,
        action: 'CLIENT_FEATURE_ADDED',
        entityType: 'ClientFeature',
        entityId: created.id,
        newData: {
          featureId: dto.featureId,
          subscriptionId: dto.subscriptionId,
        },
      });
      return created;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'This feature is already configured for the selected subscription.',
        );
      throw error;
    }
  }

  async updateClientFeature(
    clientId: string,
    clientFeatureId: string,
    dto: UpdateClientFeatureDto,
    actorId: string,
  ) {
    const current = await this.prisma.clientFeature.findFirst({
      where: { id: clientFeatureId, clientId },
    });
    if (!current) throw new NotFoundException('Client feature not found.');
    this.validateFeatureWindow(
      dto.effectiveFrom ?? current.effectiveFrom.toISOString(),
      dto.effectiveTo ?? current.effectiveTo?.toISOString(),
    );
    const { effectiveFrom, effectiveTo, configuration, ...data } = dto;
    const updated = await this.prisma.clientFeature.update({
      where: { id: clientFeatureId },
      data: {
        ...data,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
        configuration:
          configuration === undefined
            ? undefined
            : (configuration as Prisma.InputJsonValue),
      },
      include: { feature: true, subscription: { include: { package: true } } },
    });
    await this.audit.record({
      clientId: clientId,
      actorId,
      action: 'CLIENT_FEATURE_UPDATED',
      entityType: 'ClientFeature',
      entityId: clientFeatureId,
      previousData: { enabled: current.enabled, source: current.source },
      newData: { enabled: updated.enabled, source: updated.source },
    });
    return updated;
  }

  async deleteClientFeature(
    clientId: string,
    clientFeatureId: string,
    actorId: string,
  ) {
    const current = await this.prisma.clientFeature.findFirst({
      where: { id: clientFeatureId, clientId },
    });
    if (!current) throw new NotFoundException('Client feature not found.');
    await this.prisma.clientFeature.delete({ where: { id: clientFeatureId } });
    await this.audit.record({
      clientId: clientId,
      actorId,
      action: 'CLIENT_FEATURE_REMOVED',
      entityType: 'ClientFeature',
      entityId: clientFeatureId,
      previousData: {
        featureId: current.featureId,
        subscriptionId: current.subscriptionId,
      },
    });
  }

  async createClient(dto: CreateClientDto, actorId: string) {
    await assertUserMobileAvailable(this.prisma, dto.adminMobile);
    try {
      const client = await this.prisma.$transaction(async (tx) => {
        const created = await tx.client.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            companyCode: dto.slug,
            status: ClientStatus.ACTIVE,
          },
        });
        await tx.user.create({
          data: {
            clientId: created.id,
            name: dto.adminName,
            mobile: normalizeIndianMobile(dto.adminMobile),
            role: UserRole.CLIENT_ADMIN,
          },
        });
        return created;
      });
      await this.audit.record({
        actorId,
        action: 'PLATFORM_CLIENT_CREATED',
        entityType: 'Client',
        entityId: client.id,
        newData: { name: client.name, slug: client.slug },
      });
      return client;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'Client slug or administrator mobile already exists.',
        );
      throw error;
    }
  }

  async createClientDraft(dto: CreateClientDraftDto, actorId: string) {
    try {
      const client = await this.prisma.$transaction(async (tx) => {
        const created = await tx.client.create({
          data: {
            name: dto.businessFleetName,
            slug: dto.companyCode,
            companyCode: dto.companyCode,
            status: ClientStatus.DRAFT,
            isActive: true,
          },
        });
        await tx.clientBusinessProfile.create({
          data: {
            clientId: created.id,
            legalCompanyName: dto.legalEntityName,
            clientType: dto.clientType,
            businessType: dto.businessType,
            industry: dto.industry,
            gstin: dto.gstin,
            pan: dto.pan,
            cinOrLlpin: dto.cinOrLlpin,
            website: dto.website,
            yearEstablished: dto.yearEstablished,
            estimatedFleetSize: dto.estimatedFleetSize,
            estimatedRiderCount: dto.estimatedRiderCount,
            estimatedUserCount: dto.estimatedUserCount,
          },
        });
        return created;
      });
      await this.audit.record({
        actorId,
        action: 'CLIENT_DRAFT_CREATED',
        entityType: 'Client',
        entityId: client.id,
        newData: { companyCode: client.companyCode },
      });
      return client;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException('Company Code is already in use.');
      throw error;
    }
  }

  async clientDetail(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        businessProfile: true,
        contacts: true,
        addresses: true,
        operationsProfile: {
          include: {
            vehicleCategories: { include: { vehicleCategory: true } },
          },
        },
        billingProfile: true,
        documents: { orderBy: { createdAt: 'desc' } },
        agreement: true,
        subscriptions: {
          include: { package: true, features: { include: { feature: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!client) throw new NotFoundException('Client not found.');
    return { ...client, logoUrl: client.businessProfile?.logoObjectKey ? await this.storage.createDownloadUrl(client.businessProfile.logoObjectKey) : null };
  }

  async saveBusinessDetails(
    clientId: string,
    dto: UpdateClientBusinessDetailsDto,
    actorId: string,
  ) {
    const editable = await this.requireEditableClient(
      clientId,
      dto.approvalEmailReference,
    );
    const { approvalEmailReference: _approvalEmailReference, ...profile } = dto;
    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id: clientId },
        data: { name: dto.businessFleetName },
      }),
      this.prisma.clientBusinessProfile.update({
        where: { clientId },
        data: {
          legalCompanyName: profile.legalEntityName,
          clientType: profile.clientType,
          businessType: profile.businessType,
          industry: profile.industry,
          gstin: profile.gstin,
          pan: profile.pan,
          cinOrLlpin: profile.cinOrLlpin,
          website: profile.website,
          yearEstablished: profile.yearEstablished,
          estimatedFleetSize: profile.estimatedFleetSize,
          estimatedRiderCount: profile.estimatedRiderCount,
          estimatedUserCount: profile.estimatedUserCount,
        },
      }),
    ]);
    await this.audit.record({
      actorId,
      action: 'CLIENT_BUSINESS_DETAILS_UPDATED',
      entityType: 'Client',
      entityId: clientId,
      newData: this.activeEditAuditData(editable, dto.approvalEmailReference),
    });
    return this.clientDetail(clientId);
  }

  async saveContactsAndAddress(
    clientId: string,
    dto: UpdateClientContactsAndAddressDto,
    actorId: string,
  ) {
    const editable = await this.requireEditableClient(
      clientId,
      dto.approvalEmailReference,
    );
    const primary = {
      name: dto.primaryContactName,
      designation: dto.primaryDesignation,
      mobile: dto.primaryMobile,
      email: dto.primaryEmail,
      alternateMobile: dto.alternateMobile,
    };
    const admin = dto.adminSameAsPrimary
      ? primary
      : {
          name: dto.adminName!,
          designation: dto.adminDesignation,
          mobile: dto.adminMobile!,
          email: dto.adminEmail!,
          alternateMobile: undefined,
        };
    const registered = {
      line1: dto.registeredAddressLine1,
      line2: dto.registeredAddressLine2,
      landmark: dto.landmark,
      city: dto.city,
      district: dto.district,
      state: dto.state,
      country: dto.country ?? 'India',
      pinCode: dto.pinCode,
    };
    const billing = dto.billingSameAsRegistered
      ? registered
      : {
          line1: dto.billingAddressLine1!,
          line2: dto.billingAddressLine2,
          landmark: dto.billingLandmark,
          city: dto.billingCity!,
          district: dto.billingDistrict,
          state: dto.billingState!,
          country: dto.billingCountry ?? 'India',
          pinCode: dto.billingPinCode!,
        };
    await this.prisma.$transaction([
      this.prisma.clientContact.upsert({
        where: { clientId_role: { clientId, role: ClientContactRole.PRIMARY } },
        create: { clientId, role: ClientContactRole.PRIMARY, ...primary },
        update: primary,
      }),
      this.prisma.clientContact.upsert({
        where: {
          clientId_role: { clientId, role: ClientContactRole.ACCOUNT_ADMIN },
        },
        create: { clientId, role: ClientContactRole.ACCOUNT_ADMIN, ...admin },
        update: admin,
      }),
      this.prisma.clientAddress.upsert({
        where: {
          clientId_type: { clientId, type: ClientAddressType.REGISTERED },
        },
        create: { clientId, type: ClientAddressType.REGISTERED, ...registered },
        update: registered,
      }),
      this.prisma.clientAddress.upsert({
        where: { clientId_type: { clientId, type: ClientAddressType.BILLING } },
        create: { clientId, type: ClientAddressType.BILLING, ...billing },
        update: billing,
      }),
    ]);
    await this.audit.record({
      actorId,
      action: 'CLIENT_CONTACTS_AND_ADDRESS_SAVED',
      entityType: 'Client',
      entityId: clientId,
      newData: this.activeEditAuditData(editable, dto.approvalEmailReference),
    });
    return this.clientDetail(clientId);
  }

  async saveOperations(
    clientId: string,
    dto: UpdateClientOperationsDto,
    actorId: string,
  ) {
    const editable = await this.requireEditableClient(
      clientId,
      dto.approvalEmailReference,
    );
    const vehicleCategoryIds = [...new Set(dto.vehicleCategoryIds)];
    const vehicleCategories = await this.prisma.vehicleCategory.findMany({
      where: { id: { in: vehicleCategoryIds }, status: 'ACTIVE' },
    });
    if (vehicleCategories.length !== vehicleCategoryIds.length)
      throw new NotFoundException(
        'Select one or more active Vehicle Categories.',
      );
    const {
      vehicleCategoryIds: _vehicleCategoryIds,
      approvalEmailReference: _approvalEmailReference,
      ...operations
    } = dto;
    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.clientOperationsProfile.upsert({
        where: { clientId },
        create: { clientId, ...operations },
        update: operations,
      });
      await tx.clientOperationsVehicleCategory.deleteMany({
        where: { operationsProfileId: profile.id },
      });
      await tx.clientOperationsVehicleCategory.createMany({
        data: vehicleCategoryIds.map((vehicleCategoryId) => ({
          clientId,
          operationsProfileId: profile.id,
          vehicleCategoryId,
        })),
      });
    });
    await this.audit.record({
      actorId,
      action: 'CLIENT_OPERATIONS_SAVED',
      entityType: 'Client',
      entityId: clientId,
      newData: {
        vehicleCategoryIds,
        ...this.activeEditAuditData(editable, dto.approvalEmailReference),
      },
    });
    return this.clientDetail(clientId);
  }

  async savePackageSelection(
    clientId: string,
    dto: UpdateClientPackageSelectionDto,
    actorId: string,
  ) {
    const editable = await this.requireEditableClient(
      clientId,
      dto.approvalEmailReference,
    );
    const packageRecord = await this.prisma.package.findFirst({
      where: { id: dto.packageId, isActive: true },
    });
    if (!packageRecord || packageRecord.monthlyPrice === null)
      throw new NotFoundException('Selected package is unavailable.');
    const listPrice =
      dto.billingCycle === 'YEARLY'
        ? (packageRecord.yearlyPrice ?? packageRecord.monthlyPrice.mul(12))
        : packageRecord.monthlyPrice;
    const existing = await this.prisma.clientSubscription.findFirst({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });
    const values = {
      packageId: packageRecord.id,
      billingCycle: dto.billingCycle,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      listPrice,
      finalPackagePrice: listPrice,
      currency: packageRecord.currency,
      autoRenew: dto.autoRenew,
    };
    if (existing)
      await this.prisma.clientSubscription.update({
        where: { id: existing.id },
        data: values,
      });
    else
      await this.prisma.clientSubscription.create({
        data: { clientId, ...values },
      });
    await this.audit.record({
      actorId,
      action: 'CLIENT_PACKAGE_SELECTED',
      entityType: 'Client',
      entityId: clientId,
      newData: {
        packageId: dto.packageId,
        billingCycle: dto.billingCycle,
        ...this.activeEditAuditData(editable, dto.approvalEmailReference),
      },
    });
    return this.clientDetail(clientId);
  }

  async saveBilling(
    clientId: string,
    dto: UpdateClientBillingDto,
    actorId: string,
  ) {
    const editable = await this.requireEditableClient(
      clientId,
      dto.approvalEmailReference,
    );
    const { approvalEmailReference: _approvalEmailReference, ...billing } = dto;
    await this.prisma.clientBillingProfile.upsert({
      where: { clientId },
      create: { clientId, ...billing },
      update: billing,
    });
    await this.prisma.clientContact.upsert({
      where: { clientId_role: { clientId, role: ClientContactRole.BILLING } },
      create: {
        clientId,
        role: ClientContactRole.BILLING,
        name: dto.billingContactName,
        email: dto.billingEmail,
        mobile: dto.billingMobile,
      },
      update: {
        name: dto.billingContactName,
        email: dto.billingEmail,
        mobile: dto.billingMobile,
      },
    });
    await this.audit.record({
      actorId,
      action: 'CLIENT_BILLING_SAVED',
      entityType: 'Client',
      entityId: clientId,
      newData: this.activeEditAuditData(editable, dto.approvalEmailReference),
    });
    return this.clientDetail(clientId);
  }

  async saveAgreement(
    clientId: string,
    dto: UpdateClientAgreementDto,
    actorId: string,
  ) {
    const editable = await this.requireEditableClient(
      clientId,
      dto.approvalEmailReference,
    );
    if (
      !dto.termsAccepted ||
      !dto.privacyAccepted ||
      !dto.dataProcessingConsent
    )
      throw new BadRequestException(
        'Terms, privacy policy, and data processing consent are required.',
      );
    const now = new Date();
    await this.prisma.clientAgreement.upsert({
      where: { clientId },
      create: {
        clientId,
        authorizedSignatoryName: dto.authorizedSignatoryName,
        designation: dto.designation,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        dataProcessingConsentAt: now,
        kycConsentAt: dto.kycConsent ? now : undefined,
        marketingConsentAt: dto.marketingConsent ? now : undefined,
      },
      update: {
        authorizedSignatoryName: dto.authorizedSignatoryName,
        designation: dto.designation,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        dataProcessingConsentAt: now,
        kycConsentAt: dto.kycConsent ? now : undefined,
        marketingConsentAt: dto.marketingConsent ? now : undefined,
      },
    });
    await this.audit.record({
      actorId,
      action: 'CLIENT_AGREEMENT_SAVED',
      entityType: 'Client',
      entityId: clientId,
      newData: this.activeEditAuditData(editable, dto.approvalEmailReference),
    });
    return this.clientDetail(clientId);
  }

  async createDocumentUploadIntent(
    clientId: string,
    dto: CreateClientDocumentUploadIntentDto,
    actorId: string,
  ) {
    const editable = await this.requireEditableClient(
      clientId,
      dto.approvalEmailReference,
    );
    if (dto.sizeBytes > 10 * 1024 * 1024)
      throw new BadRequestException('Document size must not exceed 10 MB.');
    if (
      !Object.values(ClientDocumentType).includes(
        dto.documentType as ClientDocumentType,
      )
    )
      throw new BadRequestException('Unsupported document type.');
    const extension = dto.fileName.split('.').pop()?.toLowerCase();
    const expected = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
    }[dto.mimeType];
    if (!extension || extension !== expected)
      throw new BadRequestException(
        'File extension does not match its MIME type.',
      );
    const objectKey = `clients/${clientId}/documents/${randomUUID()}.${extension}`;
    const document = await this.prisma.clientDocument.create({
      data: {
        clientId,
        documentType: dto.documentType as ClientDocumentType,
        documentNumber: dto.documentNumber,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        objectKey,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
      },
    });
    const uploadUrl = await this.storage.createUploadUrl({
      objectKey,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });
    await this.audit.record({
      actorId,
      action: 'CLIENT_DOCUMENT_UPLOAD_REQUESTED',
      entityType: 'ClientDocument',
      entityId: document.id,
      newData: {
        clientId,
        documentType: document.documentType,
        ...this.activeEditAuditData(editable, dto.approvalEmailReference),
      },
    });
    return { document, uploadUrl };
  }

  async completeDocumentUpload(
    clientId: string,
    documentId: string,
    actorId: string,
  ) {
    const document = await this.prisma.clientDocument.findFirst({
      where: { id: documentId, clientId },
    });
    if (!document) throw new NotFoundException('Client document not found.');
    await this.storage.assertObjectExists(document.objectKey);
    const completed = await this.prisma.clientDocument.update({
      where: { id: documentId },
      data: { uploadedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'CLIENT_DOCUMENT_UPLOADED',
      entityType: 'ClientDocument',
      entityId: documentId,
      newData: { clientId },
    });
    return completed;
  }

  async documentDownloadUrl(clientId: string, documentId: string) {
    const document = await this.prisma.clientDocument.findFirst({
      where: { id: documentId, clientId, uploadedAt: { not: null } },
    });
    if (!document) throw new NotFoundException('Client document not found.');
    return { url: await this.storage.createDownloadUrl(document.objectKey) };
  }

  async submitClient(clientId: string, actorId: string) {
    const client = await this.clientDetail(clientId);
    if (client.status !== ClientStatus.DRAFT)
      throw new BadRequestException('Only a draft client can be submitted.');
    const roles = new Set(client.contacts.map((contact) => contact.role));
    const docs = new Set(
      client.documents
        .filter((document) => document.uploadedAt)
        .map((document) => document.documentType),
    );
    if (
      !client.businessProfile ||
      !client.operationsProfile ||
      !client.billingProfile ||
      !client.agreement ||
      !client.subscriptions[0] ||
      !roles.has(ClientContactRole.PRIMARY) ||
      !roles.has(ClientContactRole.ACCOUNT_ADMIN) ||
      !client.addresses.some(
        (address) => address.type === ClientAddressType.REGISTERED,
      ) ||
      !client.addresses.some(
        (address) => address.type === ClientAddressType.BILLING,
      ) ||
      !docs.has(ClientDocumentType.PAN_CARD)
    )
      throw new UnprocessableEntityException(
        'Complete all mandatory onboarding steps and upload the PAN Card before submitting.',
      );
    if (
      client.businessProfile.gstin &&
      !docs.has(ClientDocumentType.GST_CERTIFICATE)
    )
      throw new UnprocessableEntityException(
        'GST Certificate is required when GSTIN is supplied.',
      );
    if (
      ['PVT_LTD', 'LLP'].includes(client.businessProfile.businessType) &&
      !docs.has(ClientDocumentType.INCORPORATION_CERTIFICATE)
    ) {
      throw new UnprocessableEntityException(
        'Incorporation Certificate is required for the selected business type.',
      );
    }
    const admin = client.contacts.find(
      (contact) => contact.role === ClientContactRole.ACCOUNT_ADMIN,
    )!;
    if (!admin.mobile)
      throw new UnprocessableEntityException(
        'Account Admin mobile number is required.',
      );
    await assertUserMobileAvailable(this.prisma, admin.mobile);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            clientId: clientId,
            name: admin.name,
            mobile: normalizeIndianMobile(admin.mobile!),
            role: UserRole.CLIENT_ADMIN,
            isActive: true,
          },
        });
        await tx.client.update({
          where: { id: clientId },
          data: { status: ClientStatus.CREATED, isActive: true },
        });
      });
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          USER_MOBILE_CONFLICT_MESSAGE,
        );
      throw error;
    }
    await this.audit.record({
      actorId,
      action: 'CLIENT_CREATED',
      entityType: 'Client',
      entityId: clientId,
    });
    return this.clientDetail(clientId);
  }

  async approveClient(clientId: string, actorId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Client not found.');
    if (client.status !== ClientStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only a pending client can be approved.');
    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id: clientId },
        data: { status: ClientStatus.ACTIVE, isActive: true },
      }),
      this.prisma.user.updateMany({
        where: { clientId: clientId, role: UserRole.CLIENT_ADMIN },
        data: { isActive: true },
      }),
      this.prisma.clientAgreement.update({
        where: { clientId },
        data: { approvedAt: new Date(), approvedById: actorId },
      }),
    ]);
    await this.audit.record({
      actorId,
      action: 'CLIENT_APPROVED',
      entityType: 'Client',
      entityId: clientId,
    });
    return this.clientDetail(clientId);
  }

  async rejectClient(clientId: string, reason: string, actorId: string) {
    if (!reason.trim())
      throw new BadRequestException('A rejection reason is required.');
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Client not found.');
    if (client.status !== ClientStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only a pending client can be rejected.');
    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id: clientId },
        // A rejected onboarding is returned to the Client Admin for correction,
        // not disabled. SUSPENDED is the status that blocks workspace access.
        data: { status: ClientStatus.REJECTED, isActive: true },
      }),
      this.prisma.user.updateMany({
        where: { clientId, role: UserRole.CLIENT_ADMIN },
        data: { isActive: true },
      }),
      this.prisma.clientAgreement.update({
        where: { clientId },
        data: {
          rejectedAt: new Date(),
          rejectedById: actorId,
          rejectionReason: reason,
        },
      }),
    ]);
    await this.audit.record({
      actorId,
      action: 'CLIENT_REJECTED',
      entityType: 'Client',
      entityId: clientId,
      newData: { reason },
    });
    return this.clientDetail(clientId);
  }

  private async requireEditableClient(
    clientId: string,
    approvalEmailReference?: string,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Client not found.');
    if (
      client.status !== ClientStatus.DRAFT &&
      client.status !== ClientStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'Only draft or active clients can be edited.',
      );
    }
    if (
      client.status === ClientStatus.ACTIVE &&
      !approvalEmailReference?.trim()
    ) {
      throw new BadRequestException(
        'An approved email reference is required to update an active client.',
      );
    }
    return client;
  }

  private activeEditAuditData(
    client: { status: ClientStatus },
    approvalEmailReference?: string,
  ) {
    return client.status === ClientStatus.ACTIVE
      ? { approvalEmailReference: approvalEmailReference?.trim() }
      : {};
  }

  private async requireClient(clientId: string) {
    if (!(await this.prisma.client.findUnique({ where: { id: clientId } })))
      throw new NotFoundException('Client not found.');
  }
  private async requireClientSubscription(
    clientId: string,
    subscriptionId: string,
  ) {
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: subscriptionId, clientId },
    });
    if (!subscription) {
      throw new NotFoundException('Client subscription not found.');
    }
    return subscription;
  }
  private async requireClientFeature(
    clientId: string,
    clientFeatureId: string,
  ) {
    const clientFeature = await this.prisma.clientFeature.findFirst({
      where: { id: clientFeatureId, clientId },
    });
    if (!clientFeature)
      throw new NotFoundException('Client feature not found.');
    return clientFeature;
  }
  private async requireActiveFeature(featureId: string) {
    const feature = await this.prisma.feature.findFirst({
      where: { id: featureId, isActive: true },
    });
    if (!feature) throw new NotFoundException('Active feature not found.');
  }
  private async requireFeaturePricing(
    featureId: string,
    featurePricingId: string,
  ) {
    const featurePricing = await this.prisma.featurePricing.findFirst({
      where: { id: featurePricingId, featureId, isActive: true },
    });
    if (!featurePricing) {
      throw new NotFoundException(
        'Active pricing for this feature was not found.',
      );
    }
    return featurePricing;
  }
  private discountedPrice(
    listUnitPrice: Prisma.Decimal,
    discountType?: string,
    discountValue?: number,
  ) {
    if (!discountType && discountValue !== undefined) {
      throw new UnprocessableEntityException(
        'A discount type is required when a discount value is supplied.',
      );
    }
    if (discountType && discountValue === undefined) {
      throw new UnprocessableEntityException(
        'A discount value is required when a discount type is supplied.',
      );
    }
    const discount = new Prisma.Decimal(discountValue ?? 0);
    if (discountType === 'PERCENTAGE' && discount.greaterThan(100)) {
      throw new UnprocessableEntityException(
        'Percentage discount cannot exceed 100.',
      );
    }
    const finalPrice =
      discountType === 'PERCENTAGE'
        ? listUnitPrice.mul(new Prisma.Decimal(100).minus(discount)).div(100)
        : listUnitPrice.minus(discount);
    return Prisma.Decimal.max(finalPrice, new Prisma.Decimal(0));
  }
  private validateFeatureWindow(effectiveFrom: string, effectiveTo?: string) {
    if (effectiveTo && new Date(effectiveTo) < new Date(effectiveFrom)) {
      throw new UnprocessableEntityException(
        'Effective end date cannot be before the effective start date.',
      );
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
