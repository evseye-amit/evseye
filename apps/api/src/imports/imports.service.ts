import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportEntityType, ImportScope, ImportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeImportFailures } from './import-failure.js';
@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}
  createParent(clientId: string, actorId: string, filename: string, metadata: Record<string, unknown>) {
    return this.prisma.importJob.create({ data: { clientId, createdById: actorId, entityType: ImportEntityType.FLEET, originalFilename: filename, status: 'PASS', metadata: { workbook: true, ...metadata } } });
  }

  async createPlatformJob(actorId: string, entityType: ImportEntityType, filename: string, totalRows: number, metadata: Record<string, unknown> = {}) {
    return this.prisma.importJob.create({ data: { clientId: null, scope: ImportScope.PLATFORM, entityType, status: ImportStatus.FAIL, originalFilename: filename, totalRows, createdById: actorId, metadata: JSON.parse(JSON.stringify(metadata)) } });
  }

  async completePlatformJob(jobId: string, result: { passedRows: number; failures: unknown[]; createdRows?: number }) {
    const failures = normalizeImportFailures(result.failures);
    const passedRows = result.passedRows;
    const status = !passedRows ? ImportStatus.FAIL : failures.length ? ImportStatus.PARTIAL_PASS : ImportStatus.PASS;
    const job = await this.prisma.importJob.update({ where: { id: jobId }, data: { status, passedRows, failedRows: failures.length, createdRows: result.createdRows ?? passedRows, completedAt: new Date(), metadata: { failures } as Prisma.InputJsonValue } });
    return { jobId: job.id, entityType: job.entityType, scope: job.scope, status: job.status, totalRows: job.totalRows, passedRows: job.passedRows, failedRows: job.failedRows, failures };
  }

  async platformFailures(jobId: string, entityType: ImportEntityType) {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, scope: ImportScope.PLATFORM, entityType }, select: { metadata: true } });
    if (!job) return [];
    return normalizeImportFailures((job.metadata as { failures?: unknown[] } | null)?.failures);
  }

  async authorizePlatformJob(jobId: string, entityType: ImportEntityType) {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, scope: ImportScope.PLATFORM, entityType } });
    if (!job) throw new NotFoundException('Platform import job not found.');
    return job;
  }
}
