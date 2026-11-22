import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AppUpdatePolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AppCheckDto,
  AppIdentityDto,
  AppPolicySettingsDto,
  SaveAppPolicyDto,
} from './app-update.dto.js';
import {
  evaluatePolicy,
  validateRelease,
  validateSettings,
} from './app-update-policy.js';

const conflict = () =>
  new ConflictException({
    code: 'APP_UPDATE_POLICY_CONFLICT',
    message: 'This policy changed. Reload it before saving or publishing.',
  });
const json = (value: object) => value as Prisma.InputJsonValue;
const settingsOf = (value: Prisma.JsonValue) =>
  value as unknown as AppPolicySettingsDto;
function scope(identity: AppIdentityDto) {
  return {
    appCode: identity.appCode,
    platform: identity.platform,
    applicationId: identity.applicationId,
    channel: identity.channel,
  };
}
@Injectable()
export class AppUpdateService {
  constructor(private readonly prisma: PrismaService) {}

  async clientForCode(companyCode: string, resolvedClientId?: string) {
    const client = await this.prisma.client.findFirst({
      where: {
        companyCode,
        isActive: true,
        status: { notIn: ['DRAFT', 'SUSPENDED'] },
      },
      select: { id: true },
    });
    if (!client)
      throw new NotFoundException({
        code: 'WORKSPACE_UNAVAILABLE',
        message: 'Workspace unavailable.',
      });
    if (resolvedClientId && resolvedClientId !== client.id)
      throw new ForbiddenException('Workspace mismatch.');
    return client.id;
  }

  async check(clientId: string, input: AppCheckDto) {
    validateRelease(input.platform, input.installed);
    const policy = await this.prisma.appUpdatePolicy.findFirst({
      where: { clientId, ...scope(input) },
    });
    return {
      clientId,
      ...scope(input),
      installed: input.installed,
      policyRevision: policy?.publishedRevision ?? null,
      checkedAt: new Date().toISOString(),
      ...evaluatePolicy(
        policy?.published ? settingsOf(policy.published) : null,
        input.installed,
        input.platform,
      ),
    };
  }

  async list(clientId: string) {
    await this.requireClient(this.prisma, clientId);
    return this.prisma.appUpdatePolicy.findMany({
      where: { clientId },
      orderBy: [
        { appCode: 'asc' },
        { platform: 'asc' },
        { applicationId: 'asc' },
        { channel: 'asc' },
      ],
      include: { history: { orderBy: { revision: 'desc' }, take: 50 } },
    });
  }

  async save(clientId: string, actorId: string, dto: SaveAppPolicyDto) {
    validateSettings(dto, dto.settings);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.requireClient(tx, clientId);
        const existing = await tx.appUpdatePolicy.findFirst({
          where: { clientId, ...scope(dto) },
        });
        if (existing) {
          if (dto.expectedRevision !== existing.revision) throw conflict();
          return this.write(
            tx,
            existing,
            actorId,
            'DRAFT_SAVED',
            dto.settings,
            { draft: json(dto.settings) },
          );
        }
        if (dto.expectedRevision !== 0) throw conflict();
        const policy = await tx.appUpdatePolicy.create({
          data: { clientId, ...scope(dto), draft: json(dto.settings) },
        });
        await this.record(
          tx,
          policy,
          actorId,
          'DRAFT_SAVED',
          dto.settings,
          null,
        );
        return policy;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw conflict();
      throw error;
    }
  }

  publish(
    clientId: string,
    id: string,
    actorId: string,
    expectedRevision: number,
    releaseAvailable: boolean,
  ) {
    return this.change(
      clientId,
      id,
      actorId,
      expectedRevision,
      async (tx, policy) => {
        if (!policy.draft)
          throw new BadRequestException('Save a draft before publishing.');
        const settings = settingsOf(policy.draft);
        validateSettings(policy as AppIdentityDto, settings);
        if (settings.enabled && !releaseAvailable)
          throw new BadRequestException(
            'Confirm that the target release is available to all affected users before publishing.',
          );
        return this.write(tx, policy, actorId, 'PUBLISHED', settings, {
          published: json(settings),
          draft: Prisma.DbNull,
          publishedAt: new Date(),
          publishedRevision: policy.revision + 1,
        });
      },
    );
  }

  disable(
    clientId: string,
    id: string,
    actorId: string,
    expectedRevision: number,
  ) {
    return this.change(
      clientId,
      id,
      actorId,
      expectedRevision,
      async (tx, policy) => {
        if (!policy.published)
          throw new BadRequestException('This policy has not been published.');
        const settings = { ...settingsOf(policy.published), enabled: false };
        return this.write(tx, policy, actorId, 'DISABLED', settings, {
          published: json(settings),
          publishedAt: new Date(),
          publishedRevision: policy.revision + 1,
        });
      },
    );
  }

  restore(
    clientId: string,
    id: string,
    actorId: string,
    expectedRevision: number,
    sourceRevision: number,
  ) {
    return this.change(
      clientId,
      id,
      actorId,
      expectedRevision,
      async (tx, policy) => {
        const source = await tx.appUpdatePolicyRevision.findUnique({
          where: {
            policyId_revision: {
              policyId: policy.id,
              revision: sourceRevision,
            },
          },
        });
        if (!source) throw new NotFoundException('Policy revision not found.');
        const settings = settingsOf(source.snapshot);
        validateSettings(policy as AppIdentityDto, settings);
        // Restoration stages a draft; a separate reviewed publish makes it live.
        return this.write(tx, policy, actorId, 'RESTORED_TO_DRAFT', settings, {
          draft: json(settings),
        });
      },
    );
  }

  private async change<T>(
    clientId: string,
    id: string,
    actorId: string,
    expectedRevision: number,
    work: (tx: Prisma.TransactionClient, policy: AppUpdatePolicy) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.appUpdatePolicy.findFirst({
        where: { id, clientId },
      });
      if (!policy)
        throw new NotFoundException('Policy not found for this client.');
      if (policy.revision !== expectedRevision) throw conflict();
      return work(tx, policy);
    });
  }

  private async write(
    tx: Prisma.TransactionClient,
    policy: AppUpdatePolicy,
    actorId: string,
    action: string,
    snapshot: AppPolicySettingsDto,
    data: Prisma.AppUpdatePolicyUpdateManyMutationInput,
  ) {
    const updated = await tx.appUpdatePolicy.updateMany({
      where: {
        id: policy.id,
        clientId: policy.clientId,
        revision: policy.revision,
      },
      data: { ...data, revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw conflict();
    const result = await tx.appUpdatePolicy.findUniqueOrThrow({
      where: { id: policy.id },
    });
    await this.record(tx, result, actorId, action, snapshot, policy);
    return result;
  }

  private async record(
    tx: Prisma.TransactionClient,
    policy: AppUpdatePolicy,
    actorId: string,
    action: string,
    snapshot: AppPolicySettingsDto,
    previous: AppUpdatePolicy | null,
  ) {
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { name: true },
    });
    await tx.appUpdatePolicyRevision.create({
      data: {
        policyId: policy.id,
        revision: policy.revision,
        action,
        snapshot: json(snapshot),
        actorId,
        actorName: actor.name,
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: policy.clientId,
        actorId,
        action: `APP_UPDATE_${action}`,
        entityType: 'AppUpdatePolicy',
        entityId: policy.id,
        previousData: previous
          ? json({
              revision: previous.revision,
              draft: previous.draft,
              published: previous.published,
            })
          : Prisma.DbNull,
        newData: json({
          revision: policy.revision,
          ...scope(policy as AppIdentityDto),
          draft: policy.draft,
          published: policy.published,
        }),
      },
    });
  }

  private async requireClient(tx: Prisma.TransactionClient, clientId: string) {
    if (
      !(await tx.client.findUnique({
        where: { id: clientId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Client not found.');
  }
}
