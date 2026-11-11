import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
import { SupportService } from '../../src/support/support.service.js';

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


describe('Support ticket panel projections', () => {
  const staff: AuthUser = { id: 'manager-1', clientId: 'client-a', roles: [UserRole.FLEET_MANAGER] };
  it('includes rider/hub names and preserves fleet manager hub scope and cursor pagination', async () => {
    const rows = [1, 2].map((number) => ({ id: `ticket-${number}`, lastActivityAt: new Date('2026-10-16T00:00:00Z'), rider: { name: 'Aman' }, hub: { name: 'Main Hub' } }));
    const db = { userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) }, supportTicket: { findMany: vi.fn().mockResolvedValue(rows) } };
    const service = new SupportService(db as never, {} as never);
    const result = await service.list('client-a', staff, { limit: 1 });
    expect(result.items).toEqual([rows[0]]);
    expect(result.nextCursor).toBeTruthy();
    expect(db.supportTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId: 'client-a', hubId: { in: ['hub-1'] } }, take: 2,
      include: { rider: { select: { id: true, name: true, mobile: true } }, hub: { select: { id: true, name: true, code: true } } },
    }));
    await service.list('client-a', staff, { limit: 1, cursor: result.nextCursor! });
    expect(db.supportTicket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.any(Array) }) }));
  });

  it('includes conversation author names only from the authenticated client', async () => {
    const ticket = { id: 'ticket-1', hubId: 'hub-1', riderId: 'rider-1', replies: [
      { id: 'reply-1', authorId: 'rider-user', body: 'Help' }, { id: 'reply-2', authorId: 'manager-1', body: 'Checking' },
    ] };
    const db = {
      supportTicket: { findFirst: vi.fn().mockResolvedValue(ticket), findUniqueOrThrow: vi.fn().mockResolvedValue(ticket) },
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) },
      photo: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'rider-user', name: 'Aman', role: 'RIDER' }]) },
    };
    const service = new SupportService(db as never, {} as never);
    const result = await service.get('client-a', staff, 'ticket-1');
    expect(result.replies[0].author).toMatchObject({ name: 'Aman' });
    expect(result.replies[1].author).toBeNull();
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { clientId: 'client-a', id: { in: ['rider-user', 'manager-1'] } }, select: { id: true, name: true, role: true } });
  });

  it('does not load conversation details for a hub outside the fleet manager assignments', async () => {
    const db = { supportTicket: { findFirst: vi.fn().mockResolvedValue({ id: 'ticket-1', hubId: 'other-hub' }), findUniqueOrThrow: vi.fn() },
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-1' }]) } };
    await expect(new SupportService(db as never, {} as never).get('client-a', staff, 'ticket-1')).rejects.toThrow('Support ticket is not in an assigned Hub.');
    expect(db.supportTicket.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
