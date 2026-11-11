import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';
import { RiderWalletOperationsController } from '../../src/riders/rider-wallet.controller.js';
import { RiderWalletOperationsService } from '../../src/riders/rider-wallet.service.js';
import { RiderWalletTransactionsQueryDto } from '../../src/riders/dto/rider-wallet.dto.js';

describe('rider wallet read-only access', () => {
  it('limits access to financial staff and scopes both routes by authenticated client', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, RiderWalletOperationsController)).toEqual(['CLIENT_ADMIN', 'FLEET_MANAGER']);
    const balance = vi.fn(), transactions = vi.fn();
    const controller = new RiderWalletOperationsController({ balance, transactions } as never, { requireClientId: () => 'client-a' } as never);
    const actor = { id: 'admin', clientId: 'client-a', roles: ['CLIENT_ADMIN' as const] };
    const query = new RiderWalletTransactionsQueryDto();
    await controller.balance(actor, 'rider-a');
    await controller.transactions(actor, 'rider-a', query);
    expect(balance).toHaveBeenCalledWith('client-a', 'rider-a');
    expect(transactions).toHaveBeenCalledWith('client-a', 'rider-a', query);
  });
  it.each([{ page: 0 }, { pageSize: 101 }, { type: 'UNKNOWN' }, { status: 'UNKNOWN' }, { from: 'today' }])('rejects invalid transaction query %j', async values => {
    expect((await validate(plainToInstance(RiderWalletTransactionsQueryDto, values))).length).toBeGreaterThan(0);
  });
  it.each([{ from: '2026-02-30' }, { from: '2026-10-22', to: '2026-10-01' }])('rejects invalid dates before querying %j', async values => {
    const transaction = vi.fn();
    const service = new RiderWalletOperationsService({ $transaction: transaction } as never, {} as never);
    await expect(service.transactions('c', 'r', Object.assign(new RiderWalletTransactionsQueryDto(), values))).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
