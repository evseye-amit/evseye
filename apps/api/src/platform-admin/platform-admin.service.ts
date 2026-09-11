import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateOnboardingConfigDto } from './dto/create-onboarding-config.dto.js';
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
        action: 'PLATFORM_TENANT_CREATED',
        entityType: 'Tenant',
        entityId: tenant.id,
        newData: { name: tenant.name, slug: tenant.slug },
      });
      return tenant;
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException(
          'Tenant slug or administrator mobile already exists.',
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
          createdById: actorId,
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
