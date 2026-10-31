import { Injectable } from '@nestjs/common';
import { ImportEntityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}
  createParent(clientId: string, actorId: string, filename: string, metadata: Record<string, unknown>) {
    return this.prisma.importJob.create({ data: { clientId, createdById: actorId, entityType: ImportEntityType.FLEET, originalFilename: filename, status: 'PASS', metadata: { workbook: true, ...metadata } } });
  }
}
