import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, page = 1, pageSize = 50) {
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.auditLog.count({ where: { tenantId } }),
    ]);
    return { items, meta: { page, pageSize: safePageSize, total } };
  }

  record(input: {
    tenantId: string;
    actorId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    requestId?: string;
    ipAddress?: string;
    previousData?: object;
    newData?: object;
  }) {
    return this.prisma.auditLog.create({ data: input });
  }
}
