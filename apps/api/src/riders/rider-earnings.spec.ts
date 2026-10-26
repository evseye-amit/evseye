import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RiderEarningsController } from './rider-earnings.controller.js';
import { RiderEarningsService } from './rider-earnings.service.js';
import { RiderEarningsQueryDto } from './dto/rider-earnings.dto.js';

describe('rider earnings access and validation', () => {
  it('allows financial staff only and takes client scope from authentication', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, RiderEarningsController)).toEqual(['CLIENT_ADMIN', 'FLEET_MANAGER']);
    const list = vi.fn().mockResolvedValue({ items: [] });
    const controller = new RiderEarningsController({ list } as never, { requireClientId: () => 'client-a' } as never);
    const query = new RiderEarningsQueryDto();
    await controller.list({ id: 'admin', clientId: 'client-a', roles: ['CLIENT_ADMIN'] }, 'rider-a', query);
    expect(list).toHaveBeenCalledWith('client-a', 'rider-a', query);
  });
  it.each([{ page: 0 }, { pageSize: 101 }, { page: 1.5 }, { type: 'TOP_UP' }, { from: 'yesterday' }])('rejects invalid query %j', async query => {
    expect((await validate(plainToInstance(RiderEarningsQueryDto, query))).length).toBeGreaterThan(0);
  });
  it.each([{ from: '2026-02-30' }, { from: '2026-10-22', to: '2026-10-01' }])('rejects invalid date boundaries before reading data %j', async values => {
    const transaction = vi.fn();
    await expect(new RiderEarningsService({ $transaction: transaction } as never).list('c', 'r', Object.assign(new RiderEarningsQueryDto(), values))).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
