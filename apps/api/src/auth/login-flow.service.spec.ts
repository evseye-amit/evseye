import { FeatureCategory, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { LoginFlowService } from './login-flow.service.js';

const feature = (code: string, stepCode: string, order: number, configuration: Record<string, unknown> = {}) => ({
  displayOrder: order,
  configuration: null,
  feature: { code, name: code, displayOrder: order, configuration, featureStep: { code: stepCode, displayName: stepCode, displayOrder: stepCode === 'LOGIN_IDENTIFIER' ? 1 : 2 } },
});

function fixture() {
  const prisma = {
    client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1' }) },
    clientSubscription: { findFirst: vi.fn().mockResolvedValue({ package: { features: [
      feature('CAPTURE_MOBILE_NUMBER', 'LOGIN_IDENTIFIER', 10, { label: 'Rider mobile', placeholder: 'Enter mobile' }),
      feature('CAPTURE_LOGIN_OTP', 'LOGIN_VERIFICATION', 20),
      feature('SEND_OTP_VIA_SMS', 'LOGIN_VERIFICATION', 30),
      feature('SEND_OTP_VIA_EMAIL', 'LOGIN_VERIFICATION', 40),
    ] } }) },
  };
  return { prisma, service: new LoginFlowService(prisma as never) };
}

describe('LoginFlowService', () => {
  it('resolves ordered login steps from active package features and exposes only supported SMS OTP', async () => {
    const { service, prisma } = fixture();
    const flow = await service.resolve('yogmaya', 'RIDER_APP');
    expect(flow.steps.map((step) => step.code)).toEqual(['LOGIN_IDENTIFIER', 'LOGIN_VERIFICATION']);
    expect(flow.steps[0].fields[0]).toMatchObject({ featureCode: 'CAPTURE_MOBILE_NUMBER', label: 'Rider mobile', placeholder: 'Enter mobile' });
    expect(flow.methods).toEqual(['SMS_OTP']);
    expect(flow.version).toMatch(/^[a-f0-9]{16}$/);
    expect(prisma.clientSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ package: { isActive: true } }),
      include: expect.objectContaining({ package: { include: { features: expect.objectContaining({ where: expect.objectContaining({ feature: expect.objectContaining({ category: FeatureCategory.LOGIN }) }) }) } } }),
    }));
  });

  it('honors per-app package feature scope and rejects a flow without SMS', async () => {
    const { service, prisma } = fixture();
    prisma.clientSubscription.findFirst.mockResolvedValue({ package: { features: [
      feature('CAPTURE_MOBILE_NUMBER', 'LOGIN_IDENTIFIER', 10),
      feature('CAPTURE_LOGIN_OTP', 'LOGIN_VERIFICATION', 20),
      { ...feature('SEND_OTP_VIA_SMS', 'LOGIN_VERIFICATION', 30), configuration: { loginAppCodes: ['CLIENT_PANEL'] } },
    ] } });
    await expect(service.resolve('yogmaya', 'RIDER_APP')).rejects.toThrow('No supported login method');
  });

  it('keeps application roles separate', () => {
    const { service } = fixture();
    expect(service.roleAllowed('RIDER_APP', UserRole.RIDER)).toBe(true);
    expect(service.roleAllowed('RIDER_APP', UserRole.CLIENT_ADMIN)).toBe(false);
  });
});
