import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter.js';
import { exchangeErrorMessages } from '../../src/vehicle-exchanges/exchange-errors.js';

describe('exchange HTTP error messages', () => {
  it('returns the domain code and readable message rather than the internal error fallback', () => {
    const response = { header: vi.fn(), status: vi.fn(), send: vi.fn() };
    response.header.mockReturnValue(response);
    response.status.mockReturnValue(response);
    new HttpExceptionFilter().catch(new ConflictException({ code: 'EXCHANGE_DISABLED', message: exchangeErrorMessages.EXCHANGE_DISABLED }), {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers: {}, id: 'req-exchange', method: 'POST', url: '/api/v1/rider-app/vehicle-exchanges' }) }),
    } as never);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.send).toHaveBeenCalledWith({ error: { code: 'EXCHANGE_DISABLED', message: exchangeErrorMessages.EXCHANGE_DISABLED }, requestId: 'req-exchange' });
  });
});
