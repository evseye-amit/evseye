import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import { providerErrorCategory } from './cashfree-mapper.js';

export class CashfreeProviderError extends Error {
  constructor(
    public readonly category:
      ReturnType<typeof providerErrorCategory> | 'NETWORK_ERROR',
    public readonly httpStatus?: number,
  ) {
    super(`Cashfree request failed: ${category}`);
  }
}

/** TLS-only, bounded request client. No automatic retry of financial mutations. */
@Injectable()
export class CashfreeHttpClient {
  private readonly logger = new Logger(CashfreeHttpClient.name);
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Invalid Cashfree path.');
    if (method === 'POST' && !idempotencyKey)
      throw new Error('Cashfree mutations require an idempotency key.');
    const base =
      this.config.getOrThrow('CASHFREE_ENVIRONMENT') === 'PRODUCTION'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
    const requestId = crypto.randomUUID();
    const route = path
      .split('?')[0]
      .replace(/\/subscriptions\/[^/]+/, '/subscriptions/:id')
      .replace(/\/payments\/[^/]+/, '/payments/:id')
      .replace(/\/refunds\/[^/]+/, '/refunds/:id');
    this.logger.log(
      `Cashfree ${method} ${route} initiated requestId=${requestId}`,
    );
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'x-client-id': this.config.getOrThrow('CASHFREE_CLIENT_ID'),
          'x-client-secret': this.config.getOrThrow('CASHFREE_CLIENT_SECRET'),
          'x-api-version': this.config.getOrThrow('CASHFREE_API_VERSION'),
          'x-request-id': requestId,
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      this.logger.log(
        `Cashfree ${method} ${route} status=${response.status} requestId=${requestId}`,
      );
      if (!response.ok)
        throw new CashfreeProviderError(
          providerErrorCategory(response.status),
          response.status,
        );
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CashfreeProviderError) throw error;
      this.logger.warn(
        `Cashfree ${method} ${route} transport failure requestId=${requestId}`,
      );
      throw new CashfreeProviderError('NETWORK_ERROR');
    }
  }
}
