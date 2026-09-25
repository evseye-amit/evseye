import { afterEach, describe, expect, it, vi } from 'vitest';
import { OtpPurpose } from '@prisma/client';
import { TelipiaSmsProvider } from './telipia-sms.provider.js';

const settings: Record<string, string> = {
  TELIPIA_API_URL: 'https://sms.example.com/sms-panel/api/http/index.php',
  TELIPIA_USERNAME: 'account',
  TELIPIA_API_KEY: 'secret-key',
  TELIPIA_SENDER: 'EVSPRS',
  TELIPIA_ROUTE: 'TRANS',
  TELIPIA_LOGIN_TEMPLATE_ID: 'approved-login-template',
};

function provider() {
  return new TelipiaSmsProvider({
    getOrThrow: (key: string) => settings[key],
    get: (key: string) => settings[key],
  } as never);
}

afterEach(() => vi.unstubAllGlobals());

describe('TelipiaSmsProvider', () => {
  it('encodes the DLT request and sends a normalized ten-digit mobile', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"status":"success"}' });
    vi.stubGlobal('fetch', fetchMock);
    await provider().send({ phone: '+919871675222', purpose: OtpPurpose.LOGIN, code: '123456' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.searchParams.get('mobile')).toBe('9871675222');
    expect(url.searchParams.get('apikey')).toBe('secret-key');
    expect(url.searchParams.get('message')).toBe('One Time Password (OTP) for your login is 123456. Please enter it to proceed with the process. EV SPARES INDIA PRIVATE LIMITED');
    expect(url.searchParams.get('TemplateID')).toBe('approved-login-template');
    expect(url.searchParams.get('route')).toBe('TRANS');
    expect(options.redirect).toBe('error');
  });

  it('hides provider errors and credentials from callers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{"status":"failed","error":"secret-key"}' }));
    await expect(provider().send({ phone: '09871675222', purpose: OtpPurpose.LOGIN, code: '123456' }))
      .rejects.toThrow('SMS delivery is temporarily unavailable');
  });

  it('requires a separate approved template for deallocation messages', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider().send({ phone: '9871675222', purpose: OtpPurpose.DEALLOCATION_RIDER, code: '123456' }))
      .rejects.toThrow('SMS delivery is not configured for this purpose');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
