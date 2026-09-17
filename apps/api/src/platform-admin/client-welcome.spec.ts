import { describe, expect, it, vi } from 'vitest';
import { PlatformAdminService } from './platform-admin.service.js';

function setup() {
  const events: string[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn().mockImplementation(async () => {
      events.push('commit');
      return {
        id: 'client-1',
        name: 'Fleet',
        companyCode: 'fleet',
        slug: 'fleet',
      };
    }),
  };
  const welcome = {
    send: vi.fn().mockImplementation(async () => {
      events.push('email');
      return { status: 'accepted' };
    }),
  };
  const service = new PlatformAdminService(
    prisma as never,
    { record: vi.fn() } as never,
    {} as never,
    welcome as never,
  );
  return { service, prisma, welcome, events };
}
const dto = {
  name: 'Fleet',
  slug: 'fleet',
  adminName: 'Admin',
  adminMobile: '09871675222',
  adminEmail: 'admin@example.com',
};
describe('Client creation welcome trigger', () => {
  it('sends only after commit with the normalized login mobile', async () => {
    const { service, welcome, events } = setup();
    await service.createClient(dto, 'super-admin');
    expect(events).toEqual(['commit', 'email']);
    expect(welcome.send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        mobile: '+919871675222',
        companyCode: 'fleet',
      }),
      'super-admin',
    );
  });
  it('never emails when client creation fails', async () => {
    const { service, prisma, welcome } = setup();
    prisma.$transaction.mockRejectedValue(new Error('failed transaction'));
    await expect(service.createClient(dto, 'super-admin')).rejects.toThrow(
      'failed transaction',
    );
    expect(welcome.send).not.toHaveBeenCalled();
  });
});

describe('Onboarding submission welcome trigger', () => {
  const client = {
    id: 'client-1',
    name: 'Fleet',
    slug: 'fleet',
    companyCode: 'fleet',
    status: 'DRAFT',
    businessProfile: { businessType: 'PROPRIETORSHIP' },
    operationsProfile: {},
    billingProfile: {},
    agreement: {},
    subscriptions: [{}],
    contacts: [
      { role: 'PRIMARY' },
      {
        role: 'ACCOUNT_ADMIN',
        name: 'Admin',
        email: 'admin@example.com',
        mobile: '09871675222',
      },
    ],
    addresses: [{ type: 'REGISTERED' }, { type: 'BILLING' }],
    documents: [{ documentType: 'PAN_CARD', uploadedAt: new Date() }],
  };
  it('sends on successful final submission, not on invalid onboarding', async () => {
    const { service, welcome, events } = setup();
    vi.spyOn(service, 'clientDetail').mockResolvedValue(client as never);
    const result = await service.submitClient('client-1', 'super-admin');
    expect(events).toEqual(['commit', 'email']);
    expect(result.welcomeEmail.status).toBe('accepted');
    expect(welcome.send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        mobile: '+919871675222',
      }),
      'super-admin',
    );
    welcome.send.mockClear();
    vi.mocked(service.clientDetail).mockResolvedValue({
      ...client,
      documents: [],
    } as never);
    await expect(
      service.submitClient('client-1', 'super-admin'),
    ).rejects.toThrow('Complete all mandatory onboarding steps');
    expect(welcome.send).not.toHaveBeenCalled();
  });
  it('rejects resubmission without sending another welcome email', async () => {
    const { service, welcome } = setup();
    vi.spyOn(service, 'clientDetail').mockResolvedValue({
      ...client,
      status: 'CREATED',
    } as never);
    await expect(
      service.submitClient('client-1', 'super-admin'),
    ).rejects.toThrow('Only a draft');
    expect(welcome.send).not.toHaveBeenCalled();
  });
});
