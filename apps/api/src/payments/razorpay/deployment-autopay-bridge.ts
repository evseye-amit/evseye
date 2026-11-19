import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DeploymentPaymentAttempt, Prisma } from '@prisma/client';
import type { RazorpayCredentials } from './razorpay-configuration.service.js';
import type { DeploymentCheckoutOptions } from '../deployment-payment-provider.interface.js';
import type { RazorpayClient } from './razorpay.client.js';
type RazorpayOrder = Awaited<ReturnType<RazorpayClient['createOrder']>>;

export type DeploymentAutoPayTerms = {
  maxAmount: Prisma.Decimal;
  expiresAt: Date;
  consent: Prisma.InputJsonObject;
};
export interface DeploymentAutoPayHandler {
  prepare(
    clientId: string,
    userId: string,
    merchant: RazorpayCredentials,
    amount: Prisma.Decimal,
    currency: string,
    options: DeploymentCheckoutOptions,
    tx?: Prisma.TransactionClient,
  ): Promise<DeploymentAutoPayTerms>;
  createOrder(attempt: DeploymentPaymentAttempt): Promise<RazorpayOrder>;
  recover(attemptId: string, paymentId?: string): Promise<void>;
}
/** Shared bridge avoids a dependency cycle between Allocations and Payments.
 * Payments registers before requests or scheduled work can execute. */
@Injectable()
export class DeploymentAutoPayBridge {
  private handler?: DeploymentAutoPayHandler;
  register(handler: DeploymentAutoPayHandler) {
    this.handler = handler;
  }
  get service() {
    if (!this.handler)
      throw new ServiceUnavailableException({
        code: 'AUTOPAY_UNAVAILABLE',
        message: 'Combined AutoPay checkout is unavailable.',
      });
    return this.handler;
  }
}
