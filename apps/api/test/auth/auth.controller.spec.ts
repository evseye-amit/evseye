import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/auth/auth.controller.js';

function controller(prisma: Record<string, unknown>, config: Record<string, unknown> = {}) {
  return new AuthController(
    {} as never,
    {} as never,
    {} as never,
    prisma as never,
    config as never,
  );
}

describe('AuthController SMS history', () => {
  it('maps login app context to appCode without exposing context', async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: 'delivery-1', provider: 'telipia', status: 'DELIVERED', attempt: 1,
      errorCode: null, createdAt: new Date(), completedAt: new Date(),
      otpRequest: {
        phone: '+919999999999', purpose: 'LOGIN',
        context: { loginAppCode: 'CLIENT_PANEL', method: 'SMS_OTP' }, clientId: 'client-1',
      },
    }]);
    const result = await controller({ smsDelivery: { findMany } }).smsDeliveries({ id: 'admin-1', clientId: null, roles: [] }, '50');

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        otpRequest: { select: { phone: true, purpose: true, context: true, clientId: true } },
      }),
    }));
    expect(result.data[0]!.otpRequest).toEqual({
      phone: '+919999999999', purpose: 'LOGIN', appCode: 'CLIENT_PANEL', clientId: 'client-1',
    });
    expect(result.data[0]!.otpRequest).not.toHaveProperty('context');
  });
});

describe('AuthController SMS policy validation', () => {
  it('rejects console primary or fallback in production before persistence', async () => {
    const upsert = vi.fn();
    const prisma = {
      smsProviderPolicy: { findUnique: vi.fn(), upsert },
      auditLog: { create: vi.fn() },
    };
    const config = { get: vi.fn().mockReturnValue('production') };
    const auth = controller(prisma, config);

    await expect(auth.updateSmsPolicy({ id: 'admin-1', clientId: null, roles: [] }, {
      primaryProvider: 'console', fallbackProvider: 'telipia', maxAttempts: 2,
    })).rejects.toThrow('not allowed in production');
    await expect(auth.updateSmsPolicy({ id: 'admin-1', clientId: null, roles: [] }, {
      primaryProvider: 'telipia', fallbackProvider: 'console', maxAttempts: 2,
    })).rejects.toThrow('not allowed in production');
    expect(upsert).not.toHaveBeenCalled();
  });
});
