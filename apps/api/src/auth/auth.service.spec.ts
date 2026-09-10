import { OtpPurpose, OtpStatus, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

const configValues = {
  OTP_RESEND_COOLDOWN_SECONDS: 60,
  OTP_TTL_SECONDS: 300,
  OTP_MAX_ATTEMPTS: 5,
  JWT_ACCESS_SECRET: 'access-secret-with-at-least-thirty-two-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-thirty-two-characters',
  OTP_HASH_SECRET: 'otp-hash-secret-with-at-least-thirty-two-characters',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};

function createService() {
  const prisma = {
    tenant: { findFirst: vi.fn().mockResolvedValue({ id: 'tenant-1' }) },
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        mobile: '+919999999999',
        name: 'Operations User',
        role: UserRole.OPERATIONS_MANAGER,
        isActive: true,
      }),
    },
    otpRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'otp-1', expiresAt: new Date('2026-09-10T00:05:00.000Z') }),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    session: { create: vi.fn().mockResolvedValue({}) },
  };
  const jwt = { signAsync: vi.fn().mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token') };
  const sms = { send: vi.fn().mockResolvedValue(undefined) };
  const config = { getOrThrow: vi.fn((key: keyof typeof configValues) => configValues[key]) };

  return {
    prisma,
    jwt,
    sms,
    service: new AuthService(prisma as never, jwt as never, config as never, sms),
  };
}

describe('AuthService', () => {
  it('stores only a hash and sends a login OTP through the provider', async () => {
    const { service, prisma, sms } = createService();

    await service.requestLoginOtp('+919999999999', 'demo-tenant', '127.0.0.1');

    const created = prisma.otpRequest.create.mock.calls[0][0].data;
    expect(created.purpose).toBe(OtpPurpose.LOGIN);
    expect(created.otpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.otpHash).not.toContain('999999');
    expect(sms.send).toHaveBeenCalledOnce();
    expect(sms.send.mock.calls[0][0].message).toMatch(/\d{6}/);
  });

  it('issues tokens exactly once after a valid OTP verification', async () => {
    const { service, prisma, sms, jwt } = createService();
    await service.requestLoginOtp('+919999999999', 'demo-tenant');
    const code = sms.send.mock.calls[0][0].message.match(/(\d{6})/)?.[1];
    const otpHash = prisma.otpRequest.create.mock.calls[0][0].data.otpHash;
    prisma.otpRequest.findUnique.mockResolvedValue({
      id: 'otp-1',
      tenantId: 'tenant-1',
      purpose: OtpPurpose.LOGIN,
      phone: '+919999999999',
      otpHash,
      status: OtpStatus.PENDING,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.verifyLoginOtp('otp-1', code!)).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(prisma.otpRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OtpStatus.VERIFIED }) }),
    );
    expect(jwt.signAsync).toHaveBeenCalledTimes(2);

    prisma.otpRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.verifyLoginOtp('otp-1', code!)).rejects.toThrow('OTP has already been used');
  });
});
