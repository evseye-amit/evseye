import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { applicationRoles } from './notification-targeting.js';
import { mandatoryCategory } from './notification-preferences.js';
import type { UpdateNotificationPreferencesDto } from './notification-preferences.controller.js';
type Db = Prisma.TransactionClient;
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly db: PrismaService) {}
  private async authorize(
    db: Db,
    clientId: string,
    actor: AuthUser,
    application: string,
  ) {
    if (actor.clientId !== clientId)
      throw new ForbiddenException('Client mismatch.');
    const user = await db.user.findFirst({
      where: {
        id: actor.id,
        clientId,
        isActive: true,
        deletedAt: null,
        client: { isActive: true, status: { notIn: ['DRAFT', 'SUSPENDED'] } },
      },
      select: { role: true },
    });
    if (!user || !applicationRoles[application]?.includes(user.role))
      throw new ForbiddenException(
        'This application does not match your account role.',
      );
  }
  private async state(
    db: Db,
    clientId: string,
    userId: string,
    application: string,
  ) {
    const [consent, preferences, mappings] = await Promise.all([
      db.notificationConsent.findUnique({
        where: {
          clientId_userId_application: { clientId, userId, application },
        },
      }),
      db.notificationPreference.findMany({
        where: { clientId, userId, application },
      }),
      db.notificationApplicationCategory.findMany({
        where: {
          application,
          allowed: true,
          category: { isActive: true, parent: { isActive: true } },
        },
        select: { categoryCode: true },
        orderBy: { categoryCode: 'asc' },
      }),
    ]);
    const marketingEnabled = consent?.marketingEnabled ?? false;
    return {
      application,
      marketingEnabled,
      categories: mappings.map(({ categoryCode }) => {
        const mandatory = mandatoryCategory(categoryCode);
        const pushEnabled =
          mandatory ||
          (preferences.find((p) => p.categoryCode === categoryCode)
            ?.pushEnabled ??
            true);
        return {
          categoryCode,
          mandatory,
          pushEnabled,
          effectivePushEnabled:
            pushEnabled &&
            (!categoryCode.startsWith('PG11_') || marketingEnabled),
        };
      }),
    };
  }
  async get(clientId: string, actor: AuthUser, application: string) {
    await this.authorize(this.db, clientId, actor, application);
    return this.state(this.db, clientId, actor.id, application);
  }
  async update(
    clientId: string,
    actor: AuthUser,
    input: UpdateNotificationPreferencesDto,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.authorize(tx, clientId, actor, input.application);
      const current = await this.state(
        tx,
        clientId,
        actor.id,
        input.application,
      );
      const categories = input.categories ?? [];
      if (
        new Set(categories.map((c) => c.categoryCode)).size !==
        categories.length
      )
        throw new BadRequestException('Duplicate category.');
      for (const item of categories) {
        if (
          !current.categories.some((c) => c.categoryCode === item.categoryCode)
        )
          throw new BadRequestException(
            'Category is not available for this application.',
          );
        if (!item.pushEnabled && mandatoryCategory(item.categoryCode))
          throw new BadRequestException(
            'Essential notifications cannot be disabled.',
          );
      }
      const identity = {
        clientId,
        userId: actor.id,
        application: input.application,
      };
      if (input.marketingEnabled !== undefined)
        await tx.notificationConsent.upsert({
          where: { clientId_userId_application: identity },
          create: { ...identity, marketingEnabled: input.marketingEnabled },
          update: { marketingEnabled: input.marketingEnabled },
        });
      for (const item of categories)
        await tx.notificationPreference.upsert({
          where: {
            clientId_userId_application_categoryCode: {
              ...identity,
              categoryCode: item.categoryCode,
            },
          },
          create: { ...identity, ...item },
          update: { pushEnabled: item.pushEnabled },
        });
      await tx.pushDevice.updateMany({
        where: { clientId, userId: actor.id },
        data: { topicReconciledAt: null },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId: actor.id,
          action: 'NOTIFICATION_PREFERENCES_UPDATED',
          entityType: 'User',
          entityId: actor.id,
          metadata: {
            application: input.application,
            ...(input.marketingEnabled === undefined
              ? {}
              : { marketingEnabled: input.marketingEnabled }),
            categories: categories.map((c) => ({
              categoryCode: c.categoryCode,
              pushEnabled: c.pushEnabled,
            })),
          },
        },
      });
      return this.state(tx, clientId, actor.id, input.application);
    });
  }
}
