import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  PenaltyExceptionDto,
  PenaltyPageDto,
  SubmissionPenaltyOperationsController,
} from './submission-penalty.controller.js';
import { penaltyDebt, requirePenaltyClearance } from './penalty-accounting.js';
import { SubmissionPenaltyService } from './submission-penalty.service.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';

function setup() {
  const db = {
    $queryRaw: vi.fn(),
    riderInvoice: { findMany: vi.fn().mockResolvedValue([]) },
    riderCharge: { findMany: vi.fn().mockResolvedValue([]) },
    penaltyHandoverException: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  return db;
}
describe('Submission penalty handover policy', () => {
  it('groups debt by currency and does not mix units or count invoice charges twice', async () => {
    const db = setup();
    db.riderInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        currency: 'INR',
        outstandingAmount: new Prisma.Decimal('60'),
      },
    ] as never);
    db.riderCharge.findMany.mockResolvedValue([
      { id: 'charge-2', currency: 'INR', amount: new Prisma.Decimal('40') },
      { id: 'charge-3', currency: 'USD', amount: new Prisma.Decimal('5') },
    ] as never);
    const debt = await penaltyDebt(db as never, 'client', 'rider');
    expect(debt.outstanding).toEqual([
      { currency: 'INR', amount: '100.00' },
      { currency: 'USD', amount: '5.00' },
    ]);
    expect(db.riderCharge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client',
          riderId: 'rider',
          chargeType: 'RETURN_PENALTY',
          status: 'OPEN',
        },
      }),
    );
    expect(debt.digest).toBe(
      (await penaltyDebt(db as never, 'client', 'rider')).digest,
    );
  });
  it('does not query exceptions when debt is settled', async () => {
    const db = setup();
    await requirePenaltyClearance(db as never, 'client', 'rider', 'allocation');
    expect(db.penaltyHandoverException.findUnique).not.toHaveBeenCalled();
  });
  it('rejects used exceptions instead of reusing them for another handover', async () => {
    const db = setup();
    db.riderCharge.findMany.mockResolvedValue([
      { id: 'charge', currency: 'INR', amount: new Prisma.Decimal('10') },
    ] as never);
    db.penaltyHandoverException.findUnique.mockResolvedValue({
      riderId: 'rider',
      usedAt: new Date(),
    } as never);
    await expect(
      requirePenaltyClearance(db as never, 'client', 'rider', 'allocation'),
    ).rejects.toMatchObject({
      response: { code: 'UNPAID_SUBMISSION_PENALTIES' },
    });
    expect(db.penaltyHandoverException.update).not.toHaveBeenCalled();
  });
  it('rejects non-admin approval and blank reasons before any database changes', async () => {
    const service = new SubmissionPenaltyService({} as never);
    await expect(
      service.approve(
        'client',
        { id: 'manager', clientId: 'client', roles: ['FLEET_MANAGER'] },
        'allocation',
        'Exception',
      ),
    ).rejects.toThrow('Only a Client Admin');
    await expect(
      service.approve(
        'client',
        { id: 'admin', clientId: 'client', roles: ['CLIENT_ADMIN'] },
        'allocation',
        '   ',
      ),
    ).rejects.toThrow('nonblank');
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SubmissionPenaltyOperationsController.prototype.approve,
      ),
    ).toEqual(['CLIENT_ADMIN']);
  });
  it('validates pagination, filters and mandatory exception reason', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const query = { type: 'query' as const, metatype: PenaltyPageDto };
    await expect(pipe.transform({}, query)).resolves.toMatchObject({
      page: 1,
      limit: 25,
      status: 'PENDING',
    });
    await expect(
      pipe.transform({ page: '2', status: 'ALL' }, query),
    ).resolves.toMatchObject({ page: 2, status: 'ALL' });
    for (const input of [
      { page: '0' },
      { limit: '101' },
      { status: 'DISMISSED' },
      { riderId: 'foreign' },
    ])
      await expect(pipe.transform(input, query)).rejects.toThrow();
    await expect(
      pipe.transform({}, { type: 'body', metatype: PenaltyExceptionDto }),
    ).rejects.toThrow();
  });
});
