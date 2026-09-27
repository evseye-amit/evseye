import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxHttpService } from './sandbox-http.service.js';

afterEach(() => vi.unstubAllGlobals());

const values: Record<string, string | boolean> = { KYC_ENABLED: true, KYC_SANDBOX_ENVIRONMENT: 'TEST',
  KYC_SANDBOX_API_KEY: 'test-key', KYC_SANDBOX_API_SECRET: 'test-secret' };
const config = { get: (key: string) => values[key] };

describe('Sandbox HTTP authentication and resilience', () => {
  it('authenticates once and never sends the secret to verification endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { access_token: 'private-token' } }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({ data: { status: 'valid' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new SandboxHttpService(config as never);
    await service.request('/kyc/pan/verify', 'POST', { pan: 'ABCDE1234F' });
    await service.request('/kyc/pan/verify', 'POST', { pan: 'ABCDE1234F' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('https://test-api.sandbox.co.in/authenticate');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('private-token');
    expect(fetchMock.mock.calls[1][1].headers['x-api-secret']).toBeUndefined();
  });

  it('classifies rate limits without exposing provider bodies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { access_token: 'private-token' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('raw-secret-payload', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new SandboxHttpService(config as never);
    await expect(service.request('/bank/HDFC0001234', 'GET')).rejects.toThrow('RATE_LIMITED');
  });

  it('refreshes a rejected token once before retrying the request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { access_token: 'old-token' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { access_token: 'new-token' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { IFSC: 'HDFC0001234' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new SandboxHttpService(config as never);
    await expect(service.request('/bank/HDFC0001234', 'GET')).resolves.toMatchObject({ data: { IFSC: 'HDFC0001234' } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('new-token');
  });
});
