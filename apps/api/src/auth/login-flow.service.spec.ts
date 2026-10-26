import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { LoginFlowService } from './login-flow.service.js';

const component = (featureCode: string, stepCode: string, order: number, configuration: Record<string, unknown> = {}) => ({
  featureId: featureCode, featureCode, featureVersion: 1, componentType: 'FIELD', order, configuration,
  step: { code: stepCode, name: stepCode, order: stepCode === 'LOGIN_IDENTIFIER' ? 1 : 2, parentCode: 'LOGIN' },
});

function fixture() {
  const prisma = { client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1', requestedLocales: ['en', 'hi', 'mr'] }) } };
  const workflows = { resolve: vi.fn().mockResolvedValue({ version: 'a'.repeat(16), packageVersion: 2,
    components: [
      component('CAPTURE_MOBILE_NUMBER', 'LOGIN_IDENTIFIER', 10, { label: 'Rider mobile', placeholder: 'Enter mobile' }),
      component('CAPTURE_LOGIN_OTP', 'LOGIN_VERIFICATION', 20),
      component('SEND_OTP_VIA_SMS', 'LOGIN_VERIFICATION', 30),
    ] }) };
  return { workflows, service: new LoginFlowService(prisma as never, workflows as never) };
}

describe('LoginFlowService', () => {
  it.each([UserRole.ADVISOR,UserRole.QC_MANAGER])('allows %s in the client panel only',role=>{
    const {service}=fixture();
    expect(service.roleAllowed('CLIENT_PANEL',role)).toBe(true);
    expect(service.roleAllowed('FLEET_MANAGER_APP',role)).toBe(false);
    expect(service.roleAllowed('RIDER_APP',role)).toBe(false);
    expect(service.roleAllowed('TEAM_LEADER_APP',role)).toBe(false);
  });
  it('uses the same published package resolver as pre-login', async () => {
    const { service, workflows } = fixture();
    const result = await service.resolve('yogmaya', 'RIDER_APP');
    expect(workflows.resolve).toHaveBeenCalledWith('client-1', 'LOGIN', 'RIDER_APP');
    expect(result.steps.map((step) => step.code)).toEqual(['LOGIN_IDENTIFIER', 'LOGIN_VERIFICATION']);
    expect(result.steps[0].fields[0]).toMatchObject({ label: 'Rider mobile', placeholder: 'Enter mobile' });
    expect(result.packageVersion).toBe(2);
  });

  it('rejects a workflow without the supported OTP method', async () => {
    const { service, workflows } = fixture();
    workflows.resolve.mockResolvedValue({ version: 'b', packageVersion: 2, components: [
      component('CAPTURE_MOBILE_NUMBER', 'LOGIN_IDENTIFIER', 1),
      component('CAPTURE_LOGIN_OTP', 'LOGIN_VERIFICATION', 2),
    ] });
    await expect(service.resolve('yogmaya', 'RIDER_APP')).rejects.toThrow('No supported login method');
  });

  it('uses active localized login labels and falls back for drafts', async () => {
    const { service, workflows } = fixture();
    const resolved = await workflows.resolve();
    resolved.components[0].configuration.translations = {
      hi: { label: 'मोबाइल नंबर', placeholder: 'नंबर दर्ज करें', translationStatus: 'ACTIVE' },
      mr: { label: 'मोबाइल क्रमांक', translationStatus: 'DRAFT' },
    };
    workflows.resolve.mockResolvedValue(resolved);
    const hindi = await service.resolve('yogmaya', 'RIDER_APP', 'hi');
    expect(hindi.steps[0].fields[0]).toMatchObject({ label: 'मोबाइल नंबर', placeholder: 'नंबर दर्ज करें' });
    const marathi = await service.resolve('yogmaya', 'RIDER_APP', 'mr');
    expect(marathi.steps[0].fields[0].label).toBe('Rider mobile');
  });

  it('keeps application roles separate', () => {
    const { service } = fixture();
    expect(service.roleAllowed('RIDER_APP', UserRole.RIDER)).toBe(true);
    expect(service.roleAllowed('RIDER_APP', UserRole.CLIENT_ADMIN)).toBe(false);
  });
});
