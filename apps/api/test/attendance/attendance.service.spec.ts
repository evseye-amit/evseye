import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { AttendanceService } from '../../src/attendance/attendance.service.js';
import {
  CorrectAttendancePeriodDto,
  ListAttendanceDto,
} from '../../src/attendance/dto/attendance.dto.js';

const user = {
  id: 'user-1',
  clientId: null,
  roles: [UserRole.RIDER],
};

const closedInput = (() => {
  const checkOutAt = new Date(Date.now() - 60_000);
  const checkInAt = new Date(checkOutAt.getTime() - 60_000);
  return {
    checkInAt: checkInAt.toISOString(),
    checkOutAt: checkOutAt.toISOString(),
    reason: 'Missed checkout',
  };
})();

describe('AttendanceService', () => {
  it('checks a user in using the server clock and records the audit in the transaction', async () => {
    const period = {
      id: 'period-1',
      userId: 'user-1',
      clientId: null,
      checkInAt: new Date(),
      checkOutAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      attendancePeriod: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(period),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    const service = new AttendanceService(prisma as never);
    const before = Date.now();
    const result = await service.checkIn({
      id: 'user-1',
      clientId: null,
      roles: [UserRole.RIDER],
    });
    const after = Date.now();

    expect(result).toEqual(period);
    expect(tx.attendancePeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        clientId: null,
        checkOutAt: null,
        checkInAt: expect.any(Date),
      }),
    });
    const checkInAt = tx.attendancePeriod.create.mock.calls[0][0].data
      .checkInAt as Date;
    expect(checkInAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(checkInAt.getTime()).toBeLessThanOrEqual(after);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'user-1',
        action: 'ATTENDANCE_CHECKED_IN',
        entityType: 'AttendancePeriod',
        entityId: 'period-1',
      }),
    });
  });

  it('rejects a duplicate check-in without creating an audit', async () => {
    const tx = {
      attendancePeriod: {
        findFirst: vi.fn().mockResolvedValue({ id: 'open-1' }),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    await expect(
      new AttendanceService(prisma as never).checkIn(user),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.attendancePeriod.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects an admin target from another client before writing', async () => {
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      attendancePeriod: { findFirst: vi.fn(), create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    await expect(
      new AttendanceService(prisma as never).adminCheckIn(
        'client-a',
        'admin-a',
        'user-from-client-b',
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.attendancePeriod.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'user-from-client-b',
        clientId: 'client-a',
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('rejects invalid missed-period reasons and future or reversed times before a transaction', async () => {
    const prisma = { $transaction: vi.fn() };
    const service = new AttendanceService(prisma as never);

    await expect(
      service.addPeriod('client-a', 'admin-a', 'user-1', {
        ...closedInput,
        reason: '   ',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.addPeriod('client-a', 'admin-a', 'user-1', {
        ...closedInput,
        checkOutAt: closedInput.checkInAt,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.addPeriod('client-a', 'admin-a', 'user-1', {
        ...closedInput,
        checkInAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records checkout old and new timestamps with the actor in one transaction', async () => {
    const checkInAt = new Date(Date.now() - 60_000);
    const period = {
      id: 'period-1',
      userId: 'user-1',
      clientId: 'client-a',
      checkInAt,
      checkOutAt: null,
    };
    const tx = {
      attendancePeriod: {
        findFirst: vi.fn().mockResolvedValue(period),
        update: vi
          .fn()
          .mockImplementation(({ data }: { data: { checkOutAt: Date } }) =>
            Promise.resolve({ ...period, ...data }),
          ),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    const result = await new AttendanceService(prisma as never).checkOut({
      ...user,
      clientId: 'client-a',
    });

    expect(result.checkOutAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'user-1',
        action: 'ATTENDANCE_CHECKED_OUT',
        previousData: {
          userId: 'user-1',
          checkInAt: checkInAt.toISOString(),
          checkOutAt: null,
        },
        newData: expect.objectContaining({
          userId: 'user-1',
          checkInAt: checkInAt.toISOString(),
          checkOutAt: expect.any(String),
        }),
      }),
    });
  });

  it('scopes history before reading audit records and serializes bigint IDs', async () => {
    const prisma = {
      attendancePeriod: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'period-1', clientId: null }),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 7n,
            action: 'ATTENDANCE_CHECKED_IN',
            entityType: 'AttendancePeriod',
            entityId: 'period-1',
          },
        ]),
      },
    };

    const result = await new AttendanceService(prisma as never).historyMine(
      user,
      'period-1',
    );
    expect(prisma.attendancePeriod.findFirst).toHaveBeenCalledWith({
      where: { id: 'period-1', userId: 'user-1' },
      select: { id: true, clientId: true },
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        clientId: null,
        entityType: 'AttendancePeriod',
        entityId: 'period-1',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(result).toEqual([expect.objectContaining({ id: '7' })]);
  });

  it('rejects a correction that changes no timestamp and rejects null timestamps', async () => {
    const prisma = {
      $transaction: vi.fn(),
    };
    const service = new AttendanceService(prisma as never);
    await expect(
      service.correctPeriod('client-a', 'admin-a', 'period-1', {
        reason: 'Fix',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.correctPeriod('client-a', 'admin-a', 'period-1', {
        checkOutAt: null as never,
        reason: 'Fix',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts transformed single-field corrections and audits old/new values', async () => {
    const checkInAt = new Date(Date.now() - 120_000);
    const checkOutAt = new Date(Date.now() - 60_000);
    const period = {
      id: 'period-1',
      userId: 'user-1',
      clientId: 'client-a',
      checkInAt,
      checkOutAt: null,
    };
    const tx = {
      attendancePeriod: {
        findFirst: vi.fn().mockResolvedValue(period),
        update: vi
          .fn()
          .mockImplementation(({ data }: { data: typeof period }) =>
            Promise.resolve({ ...period, ...data }),
          ),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new AttendanceService(prisma as never);
    const dto = plainToInstance(CorrectAttendancePeriodDto, {
      checkOutAt: checkOutAt.toISOString(),
      reason: ' Forgot checkout ',
    });

    await expect(
      service.correctPeriod('client-a', 'admin-a', 'period-1', dto),
    ).resolves.toMatchObject({ checkOutAt });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-a',
        action: 'ATTENDANCE_PERIOD_CORRECTED',
        previousData: {
          userId: 'user-1',
          checkInAt: checkInAt.toISOString(),
          checkOutAt: null,
        },
        newData: {
          userId: 'user-1',
          checkInAt: checkInAt.toISOString(),
          checkOutAt: checkOutAt.toISOString(),
          reason: 'Forgot checkout',
        },
      }),
    });

    const closedPeriod = { ...period, checkOutAt };
    tx.attendancePeriod.findFirst.mockResolvedValue(closedPeriod);
    const correctedCheckInAt = new Date(Date.now() - 180_000);
    const checkInDto = plainToInstance(CorrectAttendancePeriodDto, {
      checkInAt: correctedCheckInAt.toISOString(),
      reason: ' Corrected start ',
    });
    await expect(
      service.correctPeriod('client-a', 'admin-a', 'period-1', checkInDto),
    ).resolves.toMatchObject({ checkInAt: correctedCheckInAt });
  });

  it('uses the saved period client for historical access after a user leaves', async () => {
    const prisma = {
      attendancePeriod: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue({
          id: 'period-1',
          clientId: 'client-a',
        }),
      },
      auditLog: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 8n, action: 'ATTENDANCE_PERIOD_ADDED' }]),
      },
    };
    const service = new AttendanceService(prisma as never);

    await service.listForClient('client-a', new ListAttendanceDto());
    expect(prisma.attendancePeriod.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client-a' },
      orderBy: [{ checkInAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });

    await expect(
      service.historyForClient('client-a', 'period-1'),
    ).resolves.toEqual([expect.objectContaining({ id: '8' })]);
    expect(prisma.attendancePeriod.findFirst).toHaveBeenCalledWith({
      where: { id: 'period-1', clientId: 'client-a' },
      select: { id: true, clientId: true },
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client-a',
        entityType: 'AttendancePeriod',
        entityId: 'period-1',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('allows correction by saved client for an inactive historical user', async () => {
    const checkInAt = new Date(Date.now() - 120_000);
    const checkOutAt = new Date(Date.now() - 60_000);
    const period = {
      id: 'period-1',
      userId: 'deleted-user',
      clientId: 'client-a',
      checkInAt,
      checkOutAt,
    };
    const tx = {
      attendancePeriod: {
        findFirst: vi.fn().mockResolvedValue(period),
        update: vi.fn().mockResolvedValue({ ...period, checkInAt }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const dto = plainToInstance(CorrectAttendancePeriodDto, {
      checkInAt: new Date(Date.now() - 180_000).toISOString(),
      reason: 'Fix deleted user period',
    });

    await expect(
      new AttendanceService(prisma as never).correctPeriod(
        'client-a',
        'admin-a',
        'period-1',
        dto,
      ),
    ).resolves.toBeTruthy();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('denies historical access when the saved period client differs', async () => {
    const prisma = {
      attendancePeriod: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (operation: (value: unknown) => unknown) =>
        operation({
          attendancePeriod: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          auditLog: { create: vi.fn() },
        }),
      ),
    };
    const service = new AttendanceService(prisma as never);
    await expect(
      service.historyForClient('client-b', 'period-1'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.correctPeriod(
        'client-b',
        'admin-b',
        'period-1',
        plainToInstance(CorrectAttendancePeriodDto, {
          checkOutAt: new Date(Date.now() - 60_000).toISOString(),
          reason: 'Unauthorized correction',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
