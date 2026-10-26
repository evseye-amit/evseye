import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { RiderReferenceReviewController } from './rider-reference-review.controller.js';
import { RejectRiderReferenceDto } from './dto/rider-reference.dto.js';

describe('Rider reference review access', () => {
  it('allows fleet managers and review roles but forbids riders on every endpoint', () => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of ['list', 'forRider', 'approve', 'reject'] as const) {
      const context = (role: UserRole) => ({ getHandler: () => RiderReferenceReviewController.prototype[handler],
        getClass: () => RiderReferenceReviewController,
        switchToHttp: () => ({ getRequest: () => ({ user: { roles: [role] } }) }) });
      for (const role of [UserRole.FLEET_MANAGER, UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR])
        expect(guard.canActivate(context(role) as never)).toBe(true);
      expect(() => guard.canActivate(context(UserRole.RIDER) as never)).toThrow('You do not have permission');
    }
  });
  it.each([undefined, '', '   ', 'x'.repeat(1001)])('requires a rejection reason at the API boundary', async (reason) => {
    const errors = await validate(Object.assign(new RejectRiderReferenceDto(), { rejectionReason: reason }));
    expect(errors.length).toBeGreaterThan(0);
  });
  it('uses authenticated client/reviewer identities and audits decisions', async () => {
    const references = { review: vi.fn().mockResolvedValue({ id: 'reference-1', riderId: 'rider-1', userId: 'rider-user', rejectionReason: 'Not known' }) };
    const audit = { record: vi.fn() };
    const controller = new RiderReferenceReviewController(references as never, { requireClientId: () => 'client-a' } as never, audit as never);
    await controller.reject({ id: 'manager-1', clientId: 'client-a', roles: [UserRole.FLEET_MANAGER] }, 'reference-1', { rejectionReason: 'Not known' });
    expect(references.review).toHaveBeenCalledWith('client-a', 'manager-1', 'reference-1', 'REJECTED', 'Not known');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-a', actorId: 'manager-1', action: 'RIDER_REFERENCE_REJECTED', entityId: 'reference-1' }));
  });
});
