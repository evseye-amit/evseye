import { createHmac } from 'node:crypto';
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
    client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1' }) },
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'user-1',
        clientId: 'client-1',
        mobile: '+919999999999',
        name: 'Operations User',
        role: UserRole.OPERATIONS_MANAGER,
        isActive: true,
      }),
    },
    otpRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date('2026-09-10T00:05:00.000Z'),
      }),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    allocation: {
      findFirst: vi.fn().mockResolvedValue({ id: 'allocation-1' }),
    },
    session: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn(), findFirst: vi.fn() },
  };
  const jwt = {
    verifyAsync: vi.fn(),
    signAsync: vi
      .fn()
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token'),
  };
  const sms = { send: vi.fn().mockResolvedValue(undefined) };
  const config = {
    getOrThrow: vi.fn((key: keyof typeof configValues) => configValues[key]),
  };

  return {
    prisma,
    jwt,
    sms,
    service: new AuthService(
      prisma as never,
      jwt as never,
      config as never,
      sms,
    ),
  };
}

describe('AuthService', () => {
  it('rejects a refresh already consumed by a concurrent request', async () => {
    const { service, prisma, jwt } = createService();
    jwt.verifyAsync.mockResolvedValue({ typ: 'refresh', id: 'user-1', sid: 'session-1', clientId: 'client-1' });
    prisma.session.findFirst.mockResolvedValue({ id: 'session-1', refreshTokenHash: createHmac('sha256', configValues.OTP_HASH_SECRET).update('refresh-token').digest('hex') });
    prisma.session.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh('refresh-token', 'client-1')).rejects.toThrow('already been used');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
  it('rejects logout from another client host without revoking the session', async () => {
    const { service, prisma, jwt } = createService();
    jwt.verifyAsync.mockResolvedValue({ typ: 'refresh', id: 'user-1', sid: 'session-1', clientId: 'client-1' });
    await expect(service.revokeSession('refresh-token', 'other-client')).rejects.toThrow('Invalid refresh token');
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('stores only a hash and sends a login OTP through the provider', async () => {
    const { service, prisma, sms } = createService();

    await service.requestLoginOtp('+919999999999', 'demo-client', '127.0.0.1');

    const created = prisma.otpRequest.create.mock.calls[0][0].data;
    expect(created.purpose).toBe(OtpPurpose.LOGIN);
    expect(created.otpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.otpHash).not.toContain('999999');
    expect(sms.send).toHaveBeenCalledOnce();
    expect(sms.send.mock.calls[0][0].message).toMatch(/\d{6}/);
  });

  it('allows platform OTP requests only for a clientless Super Admin account', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: 'platform-admin-1',
      mobile: '+919100000000',
    });

    await service.requestLoginOtp('+919100000000');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        clientId: null,
        mobile: { in: ['+919100000000', '09100000000', '9100000000'] },
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
      select: { id: true, mobile: true },
    });
    expect(
      prisma.otpRequest.create.mock.calls[0][0].data.clientId,
    ).toBeUndefined();
  });

  it('issues tokens exactly once after a valid OTP verification', async () => {
    const { service, prisma, sms, jwt } = createService();
    await service.requestLoginOtp('+919999999999', 'demo-client');
    const code = sms.send.mock.calls[0][0].message.match(/(\d{6})/)?.[1];
    const otpHash = prisma.otpRequest.create.mock.calls[0][0].data.otpHash;
    prisma.otpRequest.findUnique.mockResolvedValue({
      id: 'otp-1',
      clientId: 'client-1',
      purpose: OtpPurpose.LOGIN,
      phone: '+919999999999',
      otpHash,
      status: OtpStatus.PENDING,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.verifyLoginOtp('otp-1', code!)).resolves.toMatchObject(
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    );
    expect(prisma.otpRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OtpStatus.VERIFIED }),
      }),
    );
    expect(jwt.signAsync).toHaveBeenCalledTimes(2);

    prisma.otpRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.verifyLoginOtp('otp-1', code!)).rejects.toThrow(
      'OTP has already been used',
    );
  });

  it('rate limits deallocation OTP resend requests per allocation and party', async () => {
    const { service, prisma } = createService();
    prisma.otpRequest.findFirst.mockResolvedValue({ id: 'recent-otp' });

    await expect(
      service.requestDeallocationOtp(
        'client-1',
        '+919999999999',
        'allocation-1',
        OtpPurpose.DEALLOCATION_RIDER,
      ),
    ).rejects.toThrow('Please wait before requesting another OTP.');

    expect(prisma.otpRequest.create).not.toHaveBeenCalled();
    expect(prisma.otpRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          context: { path: ['allocationId'], equals: 'allocation-1' },
          purpose: OtpPurpose.DEALLOCATION_RIDER,
        }),
      }),
    );
  });

  it('records failed deallocation OTP attempts and locks the request at its limit', async () => {
    const { service, prisma, sms } = createService();
    await service.requestDeallocationOtp(
      'client-1',
      '+919999999999',
      'allocation-1',
      OtpPurpose.DEALLOCATION_RIDER,
    );
    const otpHash = prisma.otpRequest.create.mock.calls[0][0].data.otpHash;
    prisma.otpRequest.findFirst.mockResolvedValue({
      id: 'otp-1',
      clientId: 'client-1',
      purpose: OtpPurpose.DEALLOCATION_RIDER,
      phone: '+919999999999',
      otpHash,
      status: OtpStatus.PENDING,
      attempts: 4,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.verifyDeallocationOtp('client-1', 'otp-1', '000000'),
    ).rejects.toThrow('Invalid deallocation OTP.');

    expect(prisma.otpRequest.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { attempts: 5, status: OtpStatus.FAILED },
    });
    expect(sms.send).toHaveBeenCalledOnce();
  });
});

describe('Client host login binding', () => {
  it('does not consume an ACME OTP on another client host', async () => {
    const { service, prisma, jwt } = createService();
    prisma.otpRequest.findUnique.mockResolvedValue({
      id: 'otp-a',
      clientId: 'client-a',
      purpose: OtpPurpose.LOGIN,
      status: OtpStatus.PENDING,
    });
    await expect(
      service.verifyLoginOtp('otp-a', '123456', 'client-b'),
    ).rejects.toThrow('Invalid OTP request');
    expect(prisma.otpRequest.updateMany).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it('returns an accepted opaque challenge for unknown accounts', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    const result = await service.requestLoginOtp(
      '+919999999999',
      'demo-client',
    );
    expect(result.otpRequestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(sms.send).not.toHaveBeenCalled();
  });
});
