import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { SupportService } from './support.service.js';

const riderUser: AuthUser = { id: 'rider-user', clientId: 'client-a', roles: [UserRole.RIDER] };

describe('SupportService', () => {
  it('reopens a resolved ticket when its rider replies', async () => {
    const ticket = { id: 'ticket-1', clientId: 'client-a', riderId: 'rider-1', status: 'RESOLVED', hubId: 'hub-1' };
    const tx = {
      supportTicket: {
        findFirst: vi.fn().mockResolvedValue(ticket),
        update: vi.fn().mockResolvedValue({ ...ticket, status: 'OPEN' }),
      },
      supportReply: { create: vi.fn().mockResolvedValue({ id: 'reply-1', body: 'Still blocked' }) },
      auditLog: { create: vi.fn() },
    };
    const db = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1', status: 'ACTIVE' }) },
      supportTicket: { findFirst: vi.fn().mockResolvedValue(ticket) },
      $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const service = new SupportService(db as never, {} as never);

    await expect(service.reply('client-a', riderUser, 'ticket-1', { message: 'Still blocked' })).resolves.toMatchObject({ status: 'OPEN' });
    expect(tx.supportTicket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: expect.objectContaining({ status: 'OPEN', resolvedAt: null, resolvedById: null }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'SUPPORT_TICKET_REOPENED' }) }));
  });

  it('does not let a rider change ticket status', async () => {
    const db = { supportTicket: { findFirst: vi.fn() } };
    const service = new SupportService(db as never, {} as never);

    await expect(service.updateStatus('client-a', riderUser, 'ticket-1', { status: 'RESOLVED' })).rejects.toThrow('Riders cannot change support ticket status.');
    expect(db.supportTicket.findFirst).not.toHaveBeenCalled();
  });
});
