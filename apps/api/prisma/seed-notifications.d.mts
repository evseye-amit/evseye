import type { PrismaClient } from '@prisma/client';
export const notificationApplications: readonly string[];
export const notificationCatalog: {
  version: number;
  groups: Array<{ code: string; name: string }>;
  categories: Array<{
    code: string;
    name: string;
    description: string;
    parentCode: string;
    applications: string[];
    defaultPriority: string;
    defaultDelivery: string;
    isActive: boolean;
  }>;
};
export function seedNotifications(
  prisma: Pick<PrismaClient, '$transaction'>,
): Promise<{ groups: number; categories: number }>;
