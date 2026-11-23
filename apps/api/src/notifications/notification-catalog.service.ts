import { hash } from './notification.helpers.js';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';

export const notificationApplications = [
  'RIDER',
  'FLEET_MANAGER',
  'TEAM_LEADER',
  'ADMIN',
] as const;
export type NotificationApplication = (typeof notificationApplications)[number];
const applicationRoles: Record<NotificationApplication, string[]> = {
  RIDER: ['RIDER'],
  FLEET_MANAGER: ['FLEET_MANAGER'],
  TEAM_LEADER: ['TEAM_LEAD'],
  ADMIN: [
    'CLIENT_ADMIN',
    'FLEET_MANAGER',
    'TEAM_LEAD',
    'KYC_OPERATOR',
    'ADVISOR',
    'QC_MANAGER',
  ],
};
@Injectable()
export class NotificationCatalogService {
  constructor(private readonly db: PrismaService) {}

  async applicable(actor: AuthUser, application: NotificationApplication) {
    // A category's app mapping is applicability only, never a role grant.
    if (
      !actor.roles.some((role) => applicationRoles[application].includes(role))
    )
      throw new ForbiddenException(
        'This application does not match your account role.',
      );
    const groups = await this.db.notificationParentGroup.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        code: true,
        name: true,
        categories: {
          where: {
            isActive: true,
            applications: { some: { application, allowed: true } },
          },
          orderBy: { code: 'asc' },
          select: {
            code: true,
            name: true,
            description: true,
            defaultPriority: true,
            defaultDelivery: true,
          },
        },
      },
    });
    const visibleGroups = groups.filter((group) => group.categories.length);
    return {
      catalogVersion: 1,
      catalogRevision: hash(JSON.stringify(visibleGroups)),
      application,
      groups: visibleGroups,
    };
  }
}
