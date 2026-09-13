import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImportEntityType, ImportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateHubDto } from './dto/create-hub.dto.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}
  listHubs(clientId: string) {
    return this.prisma.hub.findMany({
      where: { clientId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }
  async createHub(clientId: string, dto: CreateHubDto) {
    await this.assertParent(clientId, dto.parentHubId);
    try {
      return await this.prisma.hub.create({ data: { ...dto, clientId } });
    } catch (error) {
      if (this.unique(error))
        throw new ConflictException('Hub code already exists.');
      throw error;
    }
  }
  async bulkCreateHubs(
    clientId: string,
    actorId: string,
    filename: string,
    rows: CreateHubDto[],
  ) {
    const existing = new Set(
      (
        await this.prisma.hub.findMany({
          where: { clientId },
          select: { code: true },
        })
      ).map((hub) => hub.code),
    );
    const seen = new Set<string>();
    const valid: CreateHubDto[] = [];
    const failures: Array<
      CreateHubDto & {
        row_number: number;
        failure_reason: string;
        failure_fields: string;
      }
    > = [];
    rows.forEach((row, index) => {
      const code = row.code?.trim().toUpperCase();
      const missing = [
        !code && 'code',
        !row.name?.trim() && 'name',
        !row.city?.trim() && 'city',
        !row.state?.trim() && 'state',
      ].filter(Boolean);
      const duplicate =
        !missing.length && (seen.has(code) || existing.has(code));
      if (missing.length || duplicate) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason: missing.length
            ? 'Required fields are missing.'
            : 'Hub code already exists for this client.',
          failure_fields: missing.length ? missing.join(',') : 'code',
        });
      } else {
        seen.add(code);
        valid.push({ ...row, code });
      }
    });
    let created = 0;
    if (valid.length) {
      await this.prisma.$transaction(
        valid.map((row) =>
          this.prisma.hub.create({ data: { ...row, clientId } }),
        ),
      );
      created = valid.length;
    }
    const status = !created
      ? ImportStatus.FAIL
      : failures.length
        ? ImportStatus.PARTIAL_PASS
        : ImportStatus.PASS;
    const job = await this.prisma.importJob.create({
      data: {
        clientId,
        entityType: ImportEntityType.HUB,
        status,
        originalFilename: filename,
        totalRows: rows.length,
        passedRows: created,
        failedRows: failures.length,
        duplicateRows: failures.filter((row) => row.failure_fields === 'code')
          .length,
        createdRows: created,
        createdById: actorId,
        completedAt: new Date(),
        metadata: JSON.parse(JSON.stringify({ failures })),
      },
    });
    return {
      jobId: job.id,
      status,
      totalRows: rows.length,
      passedRows: created,
      failedRows: failures.length,
      createdRows: created,
      failures,
    };
  }
  async failedRows(clientId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, clientId, entityType: ImportEntityType.HUB },
    });
    if (!job) throw new NotFoundException('Import job not found.');
    return (job.metadata as { failures?: unknown[] } | null)?.failures ?? [];
  }
  private async assertParent(clientId: string, parentHubId?: string) {
    if (!parentHubId) return;
    const parent = await this.prisma.hub.findFirst({
      where: { id: parentHubId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw new NotFoundException('Parent hub not found.');
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
