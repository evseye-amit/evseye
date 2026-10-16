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
import {
  ListAttendanceDto,
  type AddAttendancePeriodDto,
  type CorrectAttendancePeriodDto,
} from './dto/attendance.dto.js';

const ENTITY_TYPE = 'AttendancePeriod';

type AttendanceSnapshot = {
  userId: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
};

type AuditSnapshot = Prisma.InputJsonObject;

const isPrismaError = (error: unknown, code: string): boolean =>
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code) ||
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code);

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        });
      } catch (error) {
        if (isPrismaError(error, 'P2034') && attempt < 3) continue;
        throw error;
      }
    }
  }

  async checkIn(user: AuthUser) {
    const checkInAt = new Date();
    try {
      return await this.serializable(async (tx) => {
        const open = await tx.attendancePeriod.findFirst({
          where: { userId: user.id, checkOutAt: null },
          select: { id: true },
        });
        if (open)
          throw new ConflictException('An attendance period is already open.');

        const period = await tx.attendancePeriod.create({
          data: {
            userId: user.id,
            clientId: user.clientId,
            checkInAt,
            checkOutAt: null,
          },
        });
        await tx.auditLog.create({
          data: {
            clientId: user.clientId,
            actorId: user.id,
            action: 'ATTENDANCE_CHECKED_IN',
            entityType: ENTITY_TYPE,
            entityId: period.id,
            previousData: this.snapshot({
              userId: user.id,
              checkInAt: null,
              checkOutAt: null,
            }),
            newData: this.snapshot(period),
          },
        });
        return period;
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002'))
        throw new ConflictException('An attendance period is already open.');
      throw error;
    }
  }

  async checkOut(user: AuthUser) {
    const checkOutAt = new Date();
    return this.serializable(async (tx) => {
      const period = await tx.attendancePeriod.findFirst({
        where: { userId: user.id, checkOutAt: null },
      });
      if (!period) throw new ConflictException('No open attendance period.');
      if (checkOutAt <= period.checkInAt)
        throw new BadRequestException('Check-out must be after check-in.');

      const updated = await tx.attendancePeriod.update({
        where: { id: period.id },
        data: { checkOutAt },
      });
      await tx.auditLog.create({
        data: {
          clientId: period.clientId,
          actorId: user.id,
          action: 'ATTENDANCE_CHECKED_OUT',
          entityType: ENTITY_TYPE,
          entityId: period.id,
          previousData: this.snapshot(period),
          newData: this.snapshot(updated),
        },
      });
      return updated;
    });
  }

  async listMine(
    user: AuthUser,
    query: ListAttendanceDto = new ListAttendanceDto(),
  ) {
    return this.list({ userId: user.id }, query);
  }

  async historyMine(user: AuthUser, periodId: string) {
    const period = await this.prisma.attendancePeriod.findFirst({
      where: { id: periodId, userId: user.id },
      select: { id: true, clientId: true },
    });
    if (!period) throw new NotFoundException('Attendance period not found.');
    return this.history(period.clientId, period.id);
  }

  async adminCheckIn(clientId: string, actorId: string, userId: string) {
    this.requireClient(clientId);
    const checkInAt = new Date();
    try {
      return await this.serializable(async (tx) => {
        await this.assertActiveClientUser(tx, clientId, userId);
        const open = await tx.attendancePeriod.findFirst({
          where: { userId, checkOutAt: null },
          select: { id: true },
        });
        if (open)
          throw new ConflictException('An attendance period is already open.');
        const period = await tx.attendancePeriod.create({
          data: { userId, clientId, checkInAt, checkOutAt: null },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId,
            action: 'ATTENDANCE_CHECKED_IN',
            entityType: ENTITY_TYPE,
            entityId: period.id,
            previousData: this.snapshot({
              userId,
              checkInAt: null,
              checkOutAt: null,
            }),
            newData: this.snapshot(period),
          },
        });
        return period;
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002'))
        throw new ConflictException('An attendance period is already open.');
      throw error;
    }
  }

  async adminCheckOut(clientId: string, actorId: string, userId: string) {
    this.requireClient(clientId);
    const checkOutAt = new Date();
    return this.serializable(async (tx) => {
      await this.assertActiveClientUser(tx, clientId, userId);
      const period = await tx.attendancePeriod.findFirst({
        where: { userId, clientId, checkOutAt: null },
      });
      if (!period) throw new ConflictException('No open attendance period.');
      if (checkOutAt <= period.checkInAt)
        throw new BadRequestException('Check-out must be after check-in.');
      const updated = await tx.attendancePeriod.update({
        where: { id: period.id },
        data: { checkOutAt },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'ATTENDANCE_CHECKED_OUT',
          entityType: ENTITY_TYPE,
          entityId: period.id,
          previousData: this.snapshot(period),
          newData: this.snapshot(updated),
        },
      });
      return updated;
    });
  }

  async addPeriod(
    clientId: string,
    actorId: string,
    userId: string,
    dto: AddAttendancePeriodDto,
  ) {
    this.requireClient(clientId);
    const { checkInAt, checkOutAt } = this.closedTimes(
      dto.checkInAt,
      dto.checkOutAt,
    );
    const reason = this.reason(dto.reason);
    return this.serializable(async (tx) => {
      await this.assertActiveClientUser(tx, clientId, userId);
      const period = await tx.attendancePeriod.create({
        data: { userId, clientId, checkInAt, checkOutAt },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'ATTENDANCE_PERIOD_ADDED',
          entityType: ENTITY_TYPE,
          entityId: period.id,
          previousData: this.snapshot({
            userId,
            checkInAt: null,
            checkOutAt: null,
          }),
          newData: this.snapshot(period, reason),
        },
      });
      return period;
    });
  }

  async correctPeriod(
    clientId: string,
    actorId: string,
    periodId: string,
    dto: CorrectAttendancePeriodDto,
  ) {
    this.requireClient(clientId);
    const reason = this.reason(dto.reason);
    const hasCheckIn = dto.checkInAt !== undefined;
    const hasCheckOut = dto.checkOutAt !== undefined;
    if (!hasCheckIn && !hasCheckOut)
      throw new BadRequestException(
        'At least one attendance timestamp must change.',
      );
    if (
      dto.checkInAt === null ||
      dto.checkOutAt === null ||
      (hasCheckIn && typeof dto.checkInAt !== 'string') ||
      (hasCheckOut && typeof dto.checkOutAt !== 'string')
    )
      throw new BadRequestException(
        'Attendance timestamps must be valid dates.',
      );

    return this.serializable(async (tx) => {
      const period = await tx.attendancePeriod.findFirst({
        where: { id: periodId, clientId },
      });
      if (!period) throw new NotFoundException('Attendance period not found.');

      const now = new Date();
      const checkInAt = hasCheckIn
        ? this.inputDate(dto.checkInAt, 'checkInAt', now)
        : period.checkInAt;
      const checkOutAt = hasCheckOut
        ? this.inputDate(dto.checkOutAt, 'checkOutAt', now)
        : period.checkOutAt;
      if (checkOutAt !== null && checkOutAt <= checkInAt)
        throw new BadRequestException('Check-out must be after check-in.');
      if (
        checkInAt.getTime() === period.checkInAt.getTime() &&
        (checkOutAt?.getTime() ?? null) ===
          (period.checkOutAt?.getTime() ?? null)
      )
        throw new BadRequestException(
          'At least one attendance timestamp must change.',
        );

      const updated = await tx.attendancePeriod.update({
        where: { id: period.id },
        data: { checkInAt, checkOutAt },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'ATTENDANCE_PERIOD_CORRECTED',
          entityType: ENTITY_TYPE,
          entityId: period.id,
          previousData: this.snapshot(period),
          newData: this.snapshot(updated, reason),
        },
      });
      return updated;
    });
  }

  async listForClient(
    clientId: string,
    query: ListAttendanceDto = new ListAttendanceDto(),
  ) {
    this.requireClient(clientId);
    return this.list(
      {
        clientId,
        ...(query.userId ? { userId: query.userId } : {}),
      },
      query,
    );
  }

  async historyForClient(clientId: string, periodId: string) {
    this.requireClient(clientId);
    const period = await this.prisma.attendancePeriod.findFirst({
      where: {
        id: periodId,
        clientId,
      },
      select: { id: true, clientId: true },
    });
    if (!period) throw new NotFoundException('Attendance period not found.');
    return this.history(period.clientId, period.id);
  }

  private async list(
    where: {
      userId?: string;
      clientId?: string;
    },
    query: ListAttendanceDto,
  ) {
    const page = Math.min(Math.max(query.page ?? 1, 1), 100_000);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    const [items, total] = await Promise.all([
      this.prisma.attendancePeriod.findMany({
        where,
        orderBy: [{ checkInAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.attendancePeriod.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total } };
  }

  private async history(clientId: string | null, periodId: string) {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        clientId,
        entityType: ENTITY_TYPE,
        entityId: periodId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return entries.map((entry) => ({ ...entry, id: entry.id.toString() }));
  }

  private async assertActiveClientUser(
    tx: Prisma.TransactionClient,
    clientId: string,
    userId: string,
  ) {
    const user = await tx.user.findFirst({
      where: { id: userId, clientId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Attendance user not found.');
  }

  private requireClient(clientId: string) {
    if (!clientId)
      throw new ForbiddenException('A client-scoped identity is required.');
  }

  private closedTimes(checkIn: string, checkOut: string) {
    const now = new Date();
    const checkInAt = this.inputDate(checkIn, 'checkInAt', now);
    const checkOutAt = this.inputDate(checkOut, 'checkOutAt', now);
    if (checkOutAt <= checkInAt)
      throw new BadRequestException('Check-out must be after check-in.');
    return { checkInAt, checkOutAt };
  }

  private inputDate(value: unknown, field: string, now: Date) {
    if (typeof value !== 'string')
      throw new BadRequestException(`${field} must be a valid date.`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException(`${field} must be a valid date.`);
    if (parsed > now)
      throw new BadRequestException(
        'Attendance times cannot be in the future.',
      );
    return parsed;
  }

  private reason(value: string) {
    if (typeof value !== 'string')
      throw new BadRequestException('A reason is required.');
    const reason = value.trim();
    if (!reason || reason.length > 500)
      throw new BadRequestException('Reason must be 1 to 500 characters.');
    return reason;
  }

  private snapshot(period: AttendanceSnapshot, reason?: string): AuditSnapshot {
    return {
      userId: period.userId,
      checkInAt: period.checkInAt?.toISOString() ?? null,
      checkOutAt: period.checkOutAt?.toISOString() ?? null,
      ...(reason ? { reason } : {}),
    };
  }
}
