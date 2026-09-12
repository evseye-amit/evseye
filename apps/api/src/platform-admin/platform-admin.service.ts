import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateClientFeatureDto,
  UpdateClientFeatureDto,
} from './dto/client-feature.dto.js';
import type {
  CreateClientFeaturePricingDto,
  UpdateClientFeaturePricingDto,
} from './dto/client-feature-pricing.dto.js';
import type { CreateFeatureUsageDto } from './dto/feature-usage.dto.js';
import type { CreateOnboardingConfigDto } from './dto/create-onboarding-config.dto.js';
import type { CreateClientOnboardingDto } from './dto/create-client-onboarding.dto.js';
import type { CreateTenantDto } from './dto/create-tenant.dto.js';
import type { UpsertOnboardingConfigStepsDto } from './dto/upsert-onboarding-config-steps.dto.js';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listTenants() {
    return this.prisma.tenant.findMany({
      include: {
        _count: {
          select: { users: true, riders: true, onboardingConfigs: true },
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
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: usageTimestamp } }],
          },
        },
      },
    });
    if (!subscription) throw new NotFoundException('Active client subscription not found.');
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
      tenantId: clientId,
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
    if (Number.isNaN(periodStart.valueOf()) || Number.isNaN(periodEnd.valueOf())) {
      throw new UnprocessableEntityException('A valid billing period is required.');
    }
    if (periodEnd < periodStart) {
      throw new UnprocessableEntityException('Billing period end cannot be before start.');
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
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
              },
              orderBy: { effectiveFrom: 'desc' },
            },
          },
        },
      },
    });
    if (!subscription) throw new NotFoundException('Client subscription not found.');
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
        : Prisma.Decimal.max(quantity.minus(includedQuantity), new Prisma.Decimal(0));
      const negotiatedPricing = clientFeature?.pricing[0];
      const catalogPricing = masterPricing.find(
        (item) => item.featureId === featureId,
      );
      if (billableQuantity.greaterThan(0) && !negotiatedPricing && !catalogPricing) {
        throw new UnprocessableEntityException(
          `No active price exists for feature ${featureId}.`,
        );
      }
      const unitPrice = negotiatedPricing?.finalUnitPrice ?? catalogPricing?.unitPrice ?? new Prisma.Decimal(0);
      return {
        featureId,
        featureName:
          packageFeature?.feature.name ?? clientFeature?.feature.name ?? usage.find((item) => item.featureId === featureId)?.feature.name,
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
    await this.requireTenant(clientId);
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
      tenantId: clientId,
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
    if (!current) throw new NotFoundException('Client feature pricing not found.');
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
      tenantId: clientId,
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
    if (!current) throw new NotFoundException('Client feature pricing not found.');
    await this.prisma.clientFeaturePricing.delete({
      where: { id: clientFeaturePricingId },
    });
    await this.audit.record({
      tenantId: clientId,
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
        include: { feature: true, subscription: { include: { package: true } } },
      });
      await this.audit.record({
        tenantId: clientId,
        actorId,
        action: 'CLIENT_FEATURE_ADDED',
        entityType: 'ClientFeature',
        entityId: created.id,
        newData: { featureId: dto.featureId, subscriptionId: dto.subscriptionId },
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
      tenantId: clientId,
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
      tenantId: clientId,
      actorId,
      action: 'CLIENT_FEATURE_REMOVED',
      entityType: 'ClientFeature',
      entityId: clientFeatureId,
      previousData: { featureId: current.featureId, subscriptionId: current.subscriptionId },
    });
  }

  async createTenant(dto: CreateTenantDto, actorId: string) {
    try {
      const tenant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: { name: dto.name, slug: dto.slug },
        });
        await tx.user.create({
          data: {
            tenantId: created.id,
            name: dto.adminName,
            mobile: dto.adminMobile,
            role: UserRole.TENANT_ADMIN,
          },
        });
        return created;
      });
      await this.audit.record({
        actorId,
        action: 'PLATFORM_CLIENT_CREATED',
        entityType: 'Client',
        entityId: tenant.id,
        newData: { name: tenant.name, slug: tenant.slug },
      });
      return tenant;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'Client slug or administrator mobile already exists.',
        );
      throw error;
    }
  }

  async onboardClient(dto: CreateClientOnboardingDto, actorId: string) {
    try {
      const client = await this.prisma.$transaction(async (tx) => {
        const packageRecord = await tx.package.findUnique({
          where: { id: dto.packageId },
        });
        if (
          !packageRecord ||
          !packageRecord.isActive ||
          packageRecord.monthlyPrice === null
        ) {
          throw new NotFoundException(
            'Selected package is unavailable or has no monthly price.',
          );
        }
        const created = await tx.tenant.create({
          data: { name: dto.name, slug: dto.slug },
        });
        await tx.user.create({
          data: {
            tenantId: created.id,
            name: dto.adminName,
            mobile: dto.adminMobile,
            role: UserRole.TENANT_ADMIN,
          },
        });
        await tx.clientProfile.create({
          data: {
            clientId: created.id,
            legalCompanyName: dto.legalCompanyName,
            clientType: dto.clientType,
            businessType: dto.businessType,
            industry: dto.industry,
            gstin: dto.gstin,
            pan: dto.pan,
            cinOrLlpin: dto.cinOrLlpin,
            website: dto.website,
            logoUrl: dto.logoUrl,
            primaryContactName: dto.primaryContactName,
            primaryContactTitle: dto.primaryContactTitle,
            primaryContactMobile: dto.primaryContactMobile,
            primaryContactEmail: dto.primaryContactEmail,
            alternateMobile: dto.alternateMobile,
            registeredAddressLine1: dto.registeredAddressLine1,
            registeredAddressLine2: dto.registeredAddressLine2,
            landmark: dto.landmark,
            city: dto.city,
            district: dto.district,
            state: dto.state,
            country: dto.country ?? 'India',
            pinCode: dto.pinCode,
          },
        });
        const listPrice =
          dto.billingCycle === 'YEARLY'
            ? (packageRecord.yearlyPrice ?? packageRecord.monthlyPrice.mul(12))
            : packageRecord.monthlyPrice;
        const finalPackagePrice = this.discountedPrice(
          listPrice,
          dto.discountType,
          dto.discountValue,
        );
        await tx.clientSubscription.create({
          data: {
            clientId: created.id,
            packageId: packageRecord.id,
            billingCycle: dto.billingCycle,
            startDate: new Date(dto.startDate),
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            listPrice,
            currency: packageRecord.currency,
            discountType: dto.discountType,
            discountValue: dto.discountValue,
            finalPackagePrice,
            autoRenew: dto.autoRenew ?? true,
          },
        });
        return created;
      });
      await this.audit.record({
        actorId,
        action: 'CLIENT_ONBOARDED',
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

  listStepDefinitions() {
    return this.prisma.onboardingStepDefinition.findMany({
      orderBy: [{ stage: 'asc' }, { stepKey: 'asc' }],
    });
  }

  async listConfigs(tenantId: string) {
    await this.requireTenant(tenantId);
    return this.prisma.riderOnboardingConfig.findMany({
      include: {
        steps: {
          include: { definition: true },
          orderBy: { sequenceNo: 'asc' },
        },
      },
      where: { tenantId },
      orderBy: { version: 'desc' },
    });
  }

  async createConfig(
    tenantId: string,
    dto: CreateOnboardingConfigDto,
    actorId: string,
  ) {
    await this.requireTenant(tenantId);
    const config = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.riderOnboardingConfig.aggregate({
        where: { tenantId },
        _max: { version: true },
      });
      const clone = dto.cloneFromVersion
        ? await tx.riderOnboardingConfig.findFirst({
            where: { tenantId, version: dto.cloneFromVersion },
            include: { steps: true },
          })
        : null;
      if (dto.cloneFromVersion && !clone)
        throw new NotFoundException('Configuration version not found.');
      const definitions = clone
        ? []
        : await tx.onboardingStepDefinition.findMany({
            orderBy: [{ stage: 'asc' }, { stepKey: 'asc' }],
          });
      return tx.riderOnboardingConfig.create({
        data: {
          tenantId,
          version: (latest._max.version ?? 0) + 1,
          notes: dto.notes,
          steps: {
            create: clone
              ? clone.steps.map((step) => ({
                  definition: { connect: { stepKey: step.stepKey } },
                  enabled: step.enabled,
                  mandatory: step.mandatory,
                  blocking: step.blocking,
                  sequenceNo: step.sequenceNo,
                  verificationMode: step.verificationMode,
                  fallbackMode: step.fallbackMode,
                  maxRetryAttempts: step.maxRetryAttempts,
                  slaHours: step.slaHours,
                  dependsOn: step.dependsOn as Prisma.InputJsonValue,
                  applicableModels: step.applicableModels as
                    | Prisma.InputJsonValue
                    | undefined,
                  params: step.params as Prisma.InputJsonValue,
                  revalidationIntervalDays: step.revalidationIntervalDays,
                  expiryWarningDays: step.expiryWarningDays,
                }))
              : definitions.map((step, index) => ({
                  definition: { connect: { stepKey: step.stepKey } },
                  enabled: step.defaultEnabled,
                  mandatory: step.defaultMandatory,
                  sequenceNo: index + 1,
                  dependsOn: [],
                  params: {},
                })),
          },
        },
        include: {
          steps: {
            include: { definition: true },
            orderBy: { sequenceNo: 'asc' },
          },
        },
      });
    });
    await this.audit.record({
      tenantId,
      actorId,
      action: 'ONBOARDING_CONFIG_CREATED',
      entityType: 'RiderOnboardingConfig',
      entityId: config.id,
      newData: { version: config.version },
    });
    return config;
  }

  async upsertConfigSteps(
    configId: string,
    dto: UpsertOnboardingConfigStepsDto,
    actorId: string,
  ) {
    const config = await this.prisma.riderOnboardingConfig.findUnique({
      where: { id: configId },
      include: { steps: true },
    });
    if (!config) throw new NotFoundException('Configuration not found.');
    if (config.status !== 'DRAFT')
      throw new ConflictException('Only draft configurations can be edited.');
    await this.validateSteps(dto.steps);
    await this.prisma.$transaction(
      dto.steps.map((step) =>
        this.prisma.riderOnboardingConfigStep.upsert({
          where: { configId_stepKey: { configId, stepKey: step.stepKey } },
          create: {
            configId,
            stepKey: step.stepKey,
            enabled: step.enabled,
            mandatory: step.mandatory,
            blocking: step.blocking,
            sequenceNo: step.sequenceNo,
            verificationMode: step.verificationMode.toUpperCase(),
            slaHours: step.slaHours,
            dependsOn: step.dependsOn as Prisma.InputJsonValue,
            applicableModels: step.applicableModels as
              | Prisma.InputJsonValue
              | undefined,
            params: step.params as Prisma.InputJsonValue,
          },
          update: {
            enabled: step.enabled,
            mandatory: step.mandatory,
            blocking: step.blocking,
            sequenceNo: step.sequenceNo,
            verificationMode: step.verificationMode.toUpperCase(),
            slaHours: step.slaHours,
            dependsOn: step.dependsOn as Prisma.InputJsonValue,
            applicableModels: step.applicableModels as
              | Prisma.InputJsonValue
              | undefined,
            params: step.params as Prisma.InputJsonValue,
          },
        }),
      ),
    );
    await this.audit.record({
      tenantId: config.tenantId,
      actorId,
      action: 'ONBOARDING_CONFIG_STEPS_UPDATED',
      entityType: 'RiderOnboardingConfig',
      entityId: configId,
    });
    return this.prisma.riderOnboardingConfig.findUniqueOrThrow({
      where: { id: configId },
      include: {
        steps: {
          include: { definition: true },
          orderBy: { sequenceNo: 'asc' },
        },
      },
    });
  }

  async activateConfig(configId: string, actorId: string) {
    const config = await this.prisma.riderOnboardingConfig.findUnique({
      where: { id: configId },
      include: { steps: { include: { definition: true } } },
    });
    if (!config) throw new NotFoundException('Configuration not found.');
    if (config.status !== 'DRAFT')
      throw new ConflictException(
        'Only draft configurations can be activated.',
      );
    await this.validateSteps(
      config.steps.map((step) => ({
        ...step,
        slaHours: step.slaHours ?? undefined,
        dependsOn: step.dependsOn as string[],
        applicableModels: (step.applicableModels ?? undefined) as
          | string[]
          | undefined,
        params: step.params as Record<string, unknown>,
      })),
    );
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.riderOnboardingConfig.updateMany({
        where: { tenantId: config.tenantId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
      return tx.riderOnboardingConfig.update({
        where: { id: configId },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          effectiveFrom: new Date(),
        },
      });
    });
    await this.audit.record({
      tenantId: config.tenantId,
      actorId,
      action: 'ONBOARDING_CONFIG_ACTIVATED',
      entityType: 'RiderOnboardingConfig',
      entityId: configId,
      newData: { version: config.version },
    });
    return result;
  }

  private async requireTenant(tenantId: string) {
    if (!(await this.prisma.tenant.findUnique({ where: { id: tenantId } })))
      throw new NotFoundException('Tenant not found.');
  }
  private async requireClientSubscription(clientId: string, subscriptionId: string) {
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: subscriptionId, clientId },
    });
    if (!subscription) {
      throw new NotFoundException('Client subscription not found.');
    }
    return subscription;
  }
  private async requireClientFeature(clientId: string, clientFeatureId: string) {
    const clientFeature = await this.prisma.clientFeature.findFirst({
      where: { id: clientFeatureId, clientId },
    });
    if (!clientFeature) throw new NotFoundException('Client feature not found.');
    return clientFeature;
  }
  private async requireActiveFeature(featureId: string) {
    const feature = await this.prisma.feature.findFirst({
      where: { id: featureId, isActive: true },
    });
    if (!feature) throw new NotFoundException('Active feature not found.');
  }
  private async requireFeaturePricing(featureId: string, featurePricingId: string) {
    const featurePricing = await this.prisma.featurePricing.findFirst({
      where: { id: featurePricingId, featureId, isActive: true },
    });
    if (!featurePricing) {
      throw new NotFoundException('Active pricing for this feature was not found.');
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
      throw new UnprocessableEntityException('Percentage discount cannot exceed 100.');
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
  private async validateSteps(
    steps: Array<{
      stepKey: string;
      enabled: boolean;
      mandatory: boolean;
      sequenceNo: number;
      verificationMode: string;
      slaHours?: number;
      dependsOn: string[];
    }>,
  ) {
    if (steps.length === 0) {
      throw new UnprocessableEntityException({
        code: 'CONFIG_VALIDATION_FAILED',
        violations: [
          'An onboarding configuration must contain at least one step.',
        ],
      });
    }
    const definitions = await this.prisma.onboardingStepDefinition.findMany({
      where: { stepKey: { in: steps.map((step) => step.stepKey) } },
    });
    const byKey = new Map(steps.map((step) => [step.stepKey, step]));
    const violations: string[] = [];
    if (byKey.size !== steps.length)
      violations.push('Each onboarding step may appear only once.');
    if (new Set(steps.map((step) => step.sequenceNo)).size !== steps.length)
      violations.push(
        'Each onboarding step must have a unique sequence number.',
      );
    for (const definition of definitions) {
      const step = byKey.get(definition.stepKey)!;
      if (definition.isLockable && !step.enabled)
        violations.push(`${step.stepKey} is a platform-locked step.`);
      if (step.verificationMode.toUpperCase() === 'MANUAL' && !step.slaHours)
        violations.push(`${step.stepKey} requires an SLA for manual review.`);
      for (const dependency of step.dependsOn) {
        const parent = byKey.get(dependency);
        if (!parent?.enabled)
          violations.push(
            `${step.stepKey} depends on disabled step ${dependency}.`,
          );
        if (parent && parent.sequenceNo >= step.sequenceNo)
          violations.push(`${step.stepKey} must follow ${dependency}.`);
      }
    }
    if (definitions.length !== steps.length)
      violations.push('One or more step definitions do not exist.');
    const activation = byKey.get('activation');
    if (activation?.enabled) {
      const enabledSteps = steps.filter((step) => step.enabled);
      const lastSequence = Math.max(
        ...enabledSteps.map((step) => step.sequenceNo),
      );
      if (activation.sequenceNo !== lastSequence)
        violations.push(
          'activation must be the final enabled onboarding step.',
        );
    }
    if (violations.length)
      throw new UnprocessableEntityException({
        code: 'CONFIG_VALIDATION_FAILED',
        violations,
      });
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
