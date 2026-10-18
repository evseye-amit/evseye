import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BANK_CACHE_MAX_ENTRIES,
  BANK_CACHE_TTL_MS,
  IFSC_REQUEST_TIMEOUT_MS,
  IfscBankService,
} from './banks.service.js';

const validIfsc = 'HDFC0000001';

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('IfscBankService', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects malformed IFSC values before calling the provider', async () => {
    const fetchMock = vi.mocked(fetch);
    const service = new IfscBankService();

    await expect(service.lookup('HDFC123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes, maps, and caches a successful lookup', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(
      providerResponse({
        IFSC: validIfsc,
        BANK: 'HDFC Bank',
        BRANCH: 'MAIN BRANCH',
        ADDRESS: '1 Main Street',
        CITY: 'Mumbai',
        DISTRICT: 'Mumbai Suburban',
        STATE: 'MAHARASHTRA',
        MICR: null,
      }),
    );
    const service = new IfscBankService();

    const expected = {
      ifsc: validIfsc,
      bankName: 'HDFC Bank',
      branch: 'MAIN BRANCH',
      address: '1 Main Street',
      city: 'Mumbai',
      district: 'Mumbai Suburban',
      state: 'MAHARASHTRA',
      micr: null,
    };
    await expect(service.lookup(' hdfc0000001 ')).resolves.toEqual(expected);
    await expect(service.lookup(validIfsc)).resolves.toEqual(expected);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://ifsc.razorpay.com/${validIfsc}`,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('preserves nullable provider fields', async () => {
    vi.mocked(fetch).mockResolvedValue(
      providerResponse({
        IFSC: validIfsc,
        BANK: 'HDFC Bank',
        BRANCH: null,
        ADDRESS: null,
        CITY: null,
        DISTRICT: null,
        STATE: null,
        MICR: null,
      }),
    );
    const service = new IfscBankService();

    await expect(service.lookup(validIfsc)).resolves.toMatchObject({
      ifsc: validIfsc,
      bankName: 'HDFC Bank',
      branch: null,
      address: null,
      city: null,
      district: null,
      state: null,
      micr: null,
    });
  });

  it('maps an upstream not-found response to 404', async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse({}, 404));
    const service = new IfscBankService();

    await expect(service.lookup(validIfsc)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps upstream failures and malformed payloads distinctly', async () => {
    const service = new IfscBankService();

    vi.mocked(fetch).mockResolvedValue(providerResponse({}, 500));
    await expect(service.lookup(validIfsc)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    vi.mocked(fetch).mockResolvedValue(providerResponse({ IFSC: validIfsc }));
    await expect(service.lookup(validIfsc)).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    await expect(service.lookup(validIfsc)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('times out while reading a provider response', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
    } as Response);
    const service = new IfscBankService();
    const result = expect(service.lookup(validIfsc)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    await vi.advanceTimersByTimeAsync(IFSC_REQUEST_TIMEOUT_MS);
    await result;
  });

  it('expires cached entries and evicts the oldest entry at the bound', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .mocked(fetch)
      .mockImplementation(async (input) =>
        providerResponse({
          IFSC: String(input).split('/').at(-1),
          BANK: 'HDFC Bank',
          BRANCH: 'MAIN BRANCH',
          ADDRESS: '1 Main Street',
          CITY: 'Mumbai',
          DISTRICT: 'Mumbai Suburban',
          STATE: 'MAHARASHTRA',
          MICR: null,
        }),
      );
    const service = new IfscBankService();

    await service.lookup(validIfsc);
    await vi.advanceTimersByTimeAsync(BANK_CACHE_TTL_MS + 1);
    await service.lookup(validIfsc);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (let index = 0; index <= BANK_CACHE_MAX_ENTRIES; index += 1) {
      await service.lookup(`ABCD0${String(index).padStart(6, '0')}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3 + BANK_CACHE_MAX_ENTRIES);
    await service.lookup('ABCD0000000');
    expect(fetchMock).toHaveBeenCalledTimes(4 + BANK_CACHE_MAX_ENTRIES);
  });
});
