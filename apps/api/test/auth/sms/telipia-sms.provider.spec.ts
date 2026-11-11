import { afterEach, describe, expect, it, vi } from 'vitest';
import { OtpPurpose } from '@prisma/client';
import { TelipiaSmsProvider } from '../../../src/auth/sms/telipia-sms.provider.js';

const settings: Record<string, string> = {
  TELIPIA_API_URL: 'https://telipiacloud.in/sms-panel/api/http/index.php',
  TELIPIA_USERNAME: 'EVSPARES',
  TELIPIA_API_KEY: 'secret-key',
  TELIPIA_SENDER: 'EVSPRS',
  TELIPIA_ROUTE: 'TRANS',
  TELIPIA_LOGIN_TEMPLATE_ID: '1777179015249612922',
  TELIPIA_HANDOVER_RIDER_TEMPLATE_ID: 'approved-rider-handover-template',
  TELIPIA_HANDOVER_OPERATOR_TEMPLATE_ID: 'approved-operator-handover-template',
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
    expect(url.origin).toBe('https://telipiacloud.in');
    expect(url.pathname).toBe('/sms-panel/api/http/index.php');
    expect(url.searchParams.get('username')).toBe('EVSPARES');
    expect(url.searchParams.get('mobile')).toBe('9871675222');
    expect(url.searchParams.get('apikey')).toBe('secret-key');
    expect(url.searchParams.get('apirequest')).toBe('Text');
    expect(url.searchParams.get('sender')).toBe('EVSPRS');
    expect(url.searchParams.get('message')).toBe('One Time Password (OTP) for your login is 123456. Please enter it to proceed with the process. EV SPARES INDIA PRIVATE LIMITED');
    expect(url.searchParams.get('TemplateID')).toBe('1777179015249612922');
    expect(url.searchParams.get('route')).toBe('TRANS');
    expect(url.searchParams.get('format')).toBe('JSON');
    expect(options.redirect).toBe('error');
  });

  it('hides provider errors and credentials from callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"status":"failed","error":"secret-key"}' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider().send({ phone: '09871675222', purpose: OtpPurpose.LOGIN, code: '123456' }))
      .rejects.toThrow('SMS delivery is temporarily unavailable');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses purpose-specific handover templates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"status":"success"}' });
    vi.stubGlobal('fetch', fetchMock);
    await provider().send({ phone: '9871675222', purpose: OtpPurpose.HANDOVER_RIDER, code: '123456' });
    expect(fetchMock.mock.calls[0][0].searchParams.get('TemplateID')).toBe('approved-rider-handover-template');
    await provider().send({ phone: '9871675222', purpose: OtpPurpose.HANDOVER_OPERATOR, code: '123456' });
    expect(fetchMock.mock.calls[1][0].searchParams.get('TemplateID')).toBe('approved-operator-handover-template');
  });
});
