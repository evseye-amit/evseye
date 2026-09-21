import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  ClientStatus,
  ImportEntityType,
  ImportStatus,
  RiderStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertUserMobileAvailable, normalizeIndianMobile, USER_MOBILE_CONFLICT_MESSAGE } from '../common/phone.js';
import type { CreateRiderDto } from './dto/create-rider.dto.js';
import type { ListRidersDto } from './dto/list-riders.dto.js';
import type { UpdateRiderDto } from './dto/update-rider.dto.js';

@Injectable()
export class RidersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, dto: CreateRiderDto) {
    await assertUserMobileAvailable(this.prisma, clientId, dto.mobile);
    try {
      const rider = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clientId,
            name: dto.name,
            mobile: normalizeIndianMobile(dto.mobile),
            role: UserRole.RIDER,
          },
        });
        return tx.rider.create({ data: { ...dto, mobile: normalizeIndianMobile(dto.mobile), clientId, userId: user.id } });
      });
      await this.completeOnboardingStep(clientId);
      return rider;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          USER_MOBILE_CONFLICT_MESSAGE,
        );
      }
      throw error;
    }
  }
  async bulkCreate(
    clientId: string,
    actorId: string,
    filename: string,
    rows: CreateRiderDto[],
  ) {
    const failures: Array<
      CreateRiderDto & {
        row_number: number;
        failure_reason: string;
        failure_fields: string;
      }
    > = [];
    const seen = new Set<string>();
    let created = 0;
    for (const [index, row] of rows.entries()) {
      const canonicalMobile = normalizeIndianMobile(row.mobile);
      if (seen.has(canonicalMobile)) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason: 'Duplicate mobile in upload.',
          failure_fields: 'mobile',
        });
        continue;
      }
      seen.add(canonicalMobile);
      try {
        await this.create(clientId, row);
        created += 1;
      } catch (error) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            error instanceof Error ? error.message : 'Invalid row.',
          failure_fields: 'mobile,riderCode',
        });
      }
    }
    const status = !created
      ? ImportStatus.FAIL
      : failures.length
        ? ImportStatus.PARTIAL_PASS
        : ImportStatus.PASS;
    const job = await this.prisma.importJob.create({
      data: {
        clientId,
        entityType: ImportEntityType.RIDER,
        status,
        originalFilename: filename,
        totalRows: rows.length,
        passedRows: created,
        failedRows: failures.length,
        duplicateRows: failures.filter((row) => row.failure_fields === 'mobile')
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
    };
  }
  async failedRows(clientId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, clientId, entityType: ImportEntityType.RIDER },
      select: { metadata: true },
    });
    if (!job) throw new NotFoundException('Import job not found.');
    return (job.metadata as { failures?: unknown[] } | null)?.failures ?? [];
  }

  async list(clientId: string, query: ListRidersDto) {
    const where = {
      clientId,
      deletedAt: null,
      ...(query.status ? { status: query.status as RiderStatus } : {}),
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
              { mobile: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rider.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.rider.count({ where }),
    ]);

    return {
      items,
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(clientId: string, id: string) {
    const rider = await this.prisma.rider.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        kycs: { orderBy: { updatedAt: 'desc' } },
        allocations: {
          where: {
            status: {
              in: [
                'INSPECTION_PENDING',
                'OTP_PENDING',
                'ACTIVE',
                'DEALLOCATION_INITIATED',
              ],
            },
          },
          include: { fleet: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!rider) {
      throw new NotFoundException('Rider not found.');
    }
    return rider;
  }

  async update(clientId: string, id: string, dto: UpdateRiderDto) {
    const existing = await this.getById(clientId, id);
    if (dto.mobile !== undefined)
      await assertUserMobileAvailable(this.prisma, clientId, dto.mobile, existing.userId ?? undefined);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rider = await tx.rider.update({ where: { id }, data: { ...dto, ...(dto.mobile !== undefined ? { mobile: normalizeIndianMobile(dto.mobile) } : {}) } });
        if (existing.userId && (dto.name !== undefined || dto.mobile !== undefined)) {
          await tx.user.update({
            where: { id: existing.userId },
            data: {
              ...(dto.name !== undefined ? { name: dto.name } : {}),
              ...(dto.mobile !== undefined
                ? { mobile: normalizeIndianMobile(dto.mobile) }
                : {}),
            },
          });
        }
        return rider;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          USER_MOBILE_CONFLICT_MESSAGE,
        );
      }
      throw error;
    }
  }
  async remove(clientId: string, id: string) {
    const rider = await this.prisma.rider.findFirst({
      where: { id, clientId, deletedAt: null },
      select: { id: true, userId: true, allocations: { where: { status: { in: ['INSPECTION_PENDING', 'OTP_PENDING', 'ACTIVE', 'DEALLOCATION_INITIATED'] } }, select: { id: true }, take: 1 } },
    });
    if (!rider) throw new NotFoundException('Rider not found.');
    if (rider.allocations.length) throw new ConflictException('An active allocation prevents rider deletion.');
    await this.prisma.$transaction(async (tx) => {
      await tx.rider.update({ where: { id }, data: { deletedAt: new Date() } });
      if (rider.userId) await tx.user.update({ where: { id: rider.userId }, data: { isActive: false } });
    });
    return { deleted: true };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
  private async completeOnboardingStep(clientId: string) {
    const progress = await this.prisma.clientOnboardingProgress.findUnique({
      where: { clientId },
      include: { client: { select: { status: true } } },
    });
    if (
      !progress ||
      progress.client.status !== ClientStatus.CREATED ||
      progress.currentStep !== ClientOnboardingStep.RIDERS
    )
      return;
    await this.prisma.$transaction([
      this.prisma.clientOnboardingStepRecord.updateMany({
        where: { progressId: progress.id, step: ClientOnboardingStep.RIDERS },
        data: {
          status: ClientOnboardingStepStatus.COMPLETED,
          savedAt: new Date(),
          completedAt: new Date(),
        },
      }),
      this.prisma.clientOnboardingProgress.update({
        where: { id: progress.id },
        data: { currentStep: ClientOnboardingStep.REVIEW },
      }),
    ]);
  }
}
