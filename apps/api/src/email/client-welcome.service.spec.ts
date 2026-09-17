import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWelcomeService } from './client-welcome.service.js';

const account = {
  clientId: 'client-1',
  clientName: 'Anita',
  companyName: 'Example Fleet',
  companyCode: 'example-fleet',
  mobile: '9871675222',
  email: 'admin@example.com',
};
function setup(overrides = {}) {
  const audit = { record: vi.fn().mockResolvedValue({}) };
  const config = new ConfigService({
    EMAIL_PROVIDER: 'msg91',
    MSG91_AUTH_KEY: 'test-only',
    MSG91_EMAIL_DOMAIN: 'example.com',
    MSG91_EMAIL_FROM: 'welcome@example.com',
    MSG91_WELCOME_TEMPLATE_ID: 'welcome',
    CLIENT_LOGIN_URL: 'https://app.example.com/',
    ...overrides,
  });
  return { audit, service: new ClientWelcomeService(config, audit as never) };
}
afterEach(() => vi.unstubAllGlobals());
describe('MSG91 client welcome email', () => {
  it('sends the account variables only to the Account Admin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'success' })));
    vi.stubGlobal('fetch', fetchMock);
    const { service, audit } = setup();
    expect((await service.send(account, 'super-admin')).status).toBe(
      'accepted',
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://control.msg91.com/api/v5/email/send');
    expect(JSON.parse(options.body)).toEqual({
      recipients: [
        {
          to: [{ name: 'Anita', email: 'admin@example.com' }],
          variables: {
            client_name: 'Anita',
            company_name: 'Example Fleet',
            company_code: 'example-fleet',
            registered_mobile_number: '9871675222',
            login_url: 'https://app.example.com/',
          },
        },
      ],
      from: { name: 'Team EVs Eye', email: 'welcome@example.com' },
      domain: 'example.com',
      template_id: 'welcome',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ newData: { status: 'accepted' } }),
    );
  });
  it.each([
    [503, { status: 'error' }],
    [200, { status: 'fail' }],
    [200, { type: 'error' }],
  ])(
    'reports provider failure without throwing (%s)',
    async (status, payload) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify(payload), { status })),
      );
      expect((await setup().service.send(account, 'admin')).status).toBe(
        'failed',
      );
    },
  );
  it('does not send when disabled or missing a recipient', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(
      (
        await setup({ EMAIL_PROVIDER: 'disabled' }).service.send(
          account,
          'admin',
        )
      ).status,
    ).toBe('not_configured');
    expect(
      (await setup().service.send({ ...account, email: null }, 'admin')).status,
    ).toBe('missing_recipient');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reports network timeout without exposing provider details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('secret-provider-detail')),
    );
    const result = await setup().service.send(account, 'admin');
    expect(result.status).toBe('failed');
    expect(result.message).not.toContain('secret-provider-detail');
  });
});
