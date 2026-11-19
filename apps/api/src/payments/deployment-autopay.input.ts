import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DeploymentCheckoutOptions } from './deployment-payment-provider.interface.js';
export function deploymentRequestHash(
  allocationId: string,
  options: DeploymentCheckoutOptions,
) {
  if (options.setupAutoPay && !options.requestKey)
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Idempotency-Key is required for combined checkout.',
    });
  if (options.requestKey && !/^[A-Za-z0-9:_-]{8,120}$/.test(options.requestKey))
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid Idempotency-Key.',
    });
  return createHash('sha256')
    .update(
      JSON.stringify({
        allocationId,
        setupAutoPay: options.setupAutoPay ?? false,
        email: options.setupAutoPay ? options.email : null,
        consent: options.setupAutoPay ? options.autoPayConsent : null,
      }),
    )
    .digest('hex');
}
