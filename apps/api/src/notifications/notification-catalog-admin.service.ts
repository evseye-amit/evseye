import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { NotificationService } from './notification.service.js';
import { notificationApplications } from './notification-catalog.service.js';
import type {
  CreateCatalogCategoryDto,
  UpdateCatalogCategoryDto,
  UpdateCatalogGroupDto,
} from './notification-catalog-admin.dto.js';
const snapshot = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
const nextRevision = (previous: Date) =>
  new Date(Math.max(Date.now(), previous.getTime() + 1));
@Injectable()
export class NotificationCatalogAdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationService,
  ) {}
  private authorize(actor: AuthUser) {
    if (!actor.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException('Platform administrator required.');
  }
  async list(actor: AuthUser) {
    this.authorize(actor);
    return {
      groups: await this.db.notificationParentGroup.findMany({
        orderBy: { sortOrder: 'asc' },
        include: {
          categories: {
            orderBy: { code: 'asc' },
            include: { applications: { orderBy: { application: 'asc' } } },
          },
        },
      }),
    };
  }
  async create(actor: AuthUser, input: CreateCatalogCategoryDto) {
    this.authorize(actor);
    if (!input.code.startsWith(`${input.parentCode}_`))
      throw new BadRequestException(
        'Category code must match its parent group.',
      );
    return this.notifications.transaction(async (tx) => {
      if (
        !(await tx.notificationParentGroup.findUnique({
          where: { code: input.parentCode },
        }))
      )
        throw new NotFoundException('Parent group not found.');
      if (
        await tx.notificationCategory.findUnique({
          where: { code: input.code },
        })
      )
        throw new ConflictException('Category code already exists.');
      if (
        await tx.notificationCategory.findFirst({
          where: {
            parentCode: input.parentCode,
            name: { equals: input.name.trim(), mode: 'insensitive' },
          },
        })
      )
        throw new ConflictException(
          'A category with this name already exists in this group.',
        );
      const row = await tx.notificationCategory.create({
        data: {
          code: input.code,
          parentCode: input.parentCode,
          name: input.name.trim(),
          description: input.description.trim(),
          isActive: input.isActive,
          defaultPriority: 'NORMAL',
          defaultDelivery: 'TOKEN',
          applications: {
            create: notificationApplications.map((application) => ({
              application,
              allowed: input.applications.includes(application),
            })),
          },
        },
        include: { applications: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'NOTIFICATION_CATEGORY_CREATED',
          entityType: 'NotificationCategory',
          entityId: row.code,
          newData: snapshot(row),
        },
      });
      return row;
    });
  }
  async update(actor: AuthUser, code: string, input: UpdateCatalogCategoryDto) {
    this.authorize(actor);
    return this.notifications.transaction(async (tx) => {
      const before = await tx.notificationCategory.findUnique({
        where: { code },
        include: { applications: true },
      });
      if (!before) throw new NotFoundException('Category not found.');
      const expected = new Date(input.expectedUpdatedAt);
      if (before.updatedAt.getTime() !== expected.getTime())
        throw new ConflictException('Catalog changed. Reload before saving.');
      if (
        await tx.notificationCategory.findFirst({
          where: {
            parentCode: before.parentCode,
            code: { not: code },
            name: { equals: input.name.trim(), mode: 'insensitive' },
          },
        })
      )
        throw new ConflictException(
          'A category with this name already exists in this group.',
        );
      const result = await tx.notificationCategory.updateMany({
        where: { code, updatedAt: expected },
        data: {
          name: input.name.trim(),
          description: input.description.trim(),
          isActive: input.isActive,
          updatedAt: nextRevision(before.updatedAt),
        },
      });
      if (!result.count)
        throw new ConflictException('Catalog changed. Reload before saving.');
      for (const application of notificationApplications)
        await tx.notificationApplicationCategory.upsert({
          where: {
            categoryCode_application: { categoryCode: code, application },
          },
          create: {
            categoryCode: code,
            application,
            allowed: input.applications.includes(application),
          },
          update: { allowed: input.applications.includes(application) },
        });
      const after = await tx.notificationCategory.findUniqueOrThrow({
        where: { code },
        include: { applications: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'NOTIFICATION_CATEGORY_UPDATED',
          entityType: 'NotificationCategory',
          entityId: code,
          previousData: snapshot(before),
          newData: snapshot(after),
        },
      });
      return after;
    });
  }
  async group(actor: AuthUser, code: string, input: UpdateCatalogGroupDto) {
    this.authorize(actor);
    return this.notifications.transaction(async (tx) => {
      const before = await tx.notificationParentGroup.findUnique({
        where: { code },
      });
      if (!before) throw new NotFoundException('Parent group not found.');
      const expected = new Date(input.expectedUpdatedAt);
      if (before.updatedAt.getTime() !== expected.getTime())
        throw new ConflictException('Catalog changed. Reload before saving.');
      const changed = await tx.notificationParentGroup.updateMany({
        where: { code, updatedAt: expected },
        data: {
          isActive: input.isActive,
          updatedAt: nextRevision(before.updatedAt),
        },
      });
      if (!changed.count)
        throw new ConflictException('Catalog changed. Reload before saving.');
      const after = await tx.notificationParentGroup.findUniqueOrThrow({
        where: { code },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'NOTIFICATION_PARENT_GROUP_UPDATED',
          entityType: 'NotificationParentGroup',
          entityId: code,
          previousData: snapshot(before),
          newData: snapshot(after),
        },
      });
      return after;
    });
  }
}
