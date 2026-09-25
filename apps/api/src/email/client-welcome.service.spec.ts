import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { ClientWelcomeService } from './client-welcome.service.js';

const account = {
  clientId: 'client-1', clientName: 'Anita', companyName: 'Example Fleet',
  companyCode: 'example-fleet', mobile: '9871675222', email: 'admin@example.com',
};

function setup(configured = true) {
  const audit = { record: vi.fn().mockResolvedValue({}) };
  const provider = { isConfigured: vi.fn().mockReturnValue(configured), sendWelcome: vi.fn().mockResolvedValue(undefined) };
  const config = new ConfigService({ CLIENT_LOGIN_URL: 'https://app.example.com/' });
  const service = new ClientWelcomeService(config, audit as never, provider);
  return { audit, provider, service };
}

describe('ClientWelcomeService', () => {
  it('sends account details to the configured provider and audits acceptance', async () => {
    const { service, provider, audit } = setup();
    expect((await service.send(account, 'super-admin')).status).toBe('accepted');
    expect(provider.sendWelcome).toHaveBeenCalledWith({
      recipientEmail: 'admin@example.com', recipientName: 'Anita',
      companyName: 'Example Fleet', companyCode: 'example-fleet',
      registeredMobileNumber: '9871675222', loginUrl: 'https://app.example.com/',
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ newData: { status: 'accepted' } }));
  });

  it('does not call a disabled provider or send without a recipient', async () => {
    const disabled = setup(false);
    expect((await disabled.service.send(account, 'admin')).status).toBe('not_configured');
    expect(disabled.provider.sendWelcome).not.toHaveBeenCalled();
    const missing = setup();
    expect((await missing.service.send({ ...account, email: null }, 'admin')).status).toBe('missing_recipient');
    expect(missing.provider.sendWelcome).not.toHaveBeenCalled();
  });

  it('reports provider failures without exposing private details', async () => {
    const { service, provider } = setup();
    provider.sendWelcome.mockRejectedValue(new Error('secret-provider-detail'));
    const result = await service.send(account, 'admin');
    expect(result.status).toBe('failed');
    expect(result.message).not.toContain('secret-provider-detail');
  });
});
