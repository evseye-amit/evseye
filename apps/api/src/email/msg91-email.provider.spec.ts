import { afterEach, describe, expect, it, vi } from 'vitest';
import { Msg91EmailProvider } from './msg91-email.provider.js';

const values: Record<string, string> = {
  MSG91_AUTH_KEY: 'test-only-key',
  MSG91_EMAIL_DOMAIN: 'example.com',
  MSG91_EMAIL_FROM: 'welcome@example.com',
  MSG91_WELCOME_TEMPLATE_ID: 'welcome_client_mail',
};
const input = {
  recipientEmail: 'admin@example.com', recipientName: 'Anita',
  companyName: 'Example Fleet', companyCode: 'example-fleet',
  registeredMobileNumber: '9871675222', loginUrl: 'https://app.example.com/',
};
const provider = () => new Msg91EmailProvider({
  get: (key: string) => values[key],
  getOrThrow: (key: string) => values[key],
} as never);
afterEach(() => vi.unstubAllGlobals());

describe('Msg91EmailProvider', () => {
  it('posts the approved template variables and sender to MSG91', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success' })));
    vi.stubGlobal('fetch', fetchMock);
    await provider().sendWelcome(input);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://control.msg91.com/api/v5/email/send');
    expect(options.headers.authkey).toBe('test-only-key');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toEqual({
      recipients: [{ to: [{ email: 'admin@example.com', name: 'Anita' }], variables: {
        client_name: 'Anita', company_name: 'Example Fleet', company_code: 'example-fleet',
        registered_mobile_number: '9871675222', login_url: 'https://app.example.com/',
      } }],
      from: { email: 'welcome@example.com' },
      domain: 'example.com', template_id: 'welcome_client_mail',
    });
  });

  it.each([
    [503, { status: 'error' }],
    [200, { status: 'fail' }],
    [200, { type: 'error' }],
    [200, { hasError: true }],
  ])('rejects provider failure (%s)', async (status, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })));
    await expect(provider().sendWelcome(input)).rejects.toThrow('Email provider rejected');
  });
});
