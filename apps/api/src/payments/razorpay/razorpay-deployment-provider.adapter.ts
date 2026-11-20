import { Injectable } from '@nestjs/common';
import type {
  DeploymentPaymentOrder,
  DeploymentCheckoutOptions,
  DeploymentPaymentProvider,
} from '../deployment-payment-provider.interface.js';
import { RazorpayDeploymentService } from './razorpay-deployment.service.js';

@Injectable()
export class RazorpayDeploymentProviderAdapter
  implements DeploymentPaymentProvider
{
  readonly name = 'RAZORPAY';

  reconcile(clientId: string, _userId: string, allocationId: string, _attemptId: string) {
    return this.deployment.reconcileAllocation(clientId, allocationId);
  }

  constructor(private readonly deployment: RazorpayDeploymentService) {}

  async createOrder(
    clientId: string,
    userId: string,
    allocationId: string,
    options?: DeploymentCheckoutOptions,
  ): Promise<DeploymentPaymentOrder> {
    const order = await this.deployment.createOrder(clientId, userId, allocationId, options);
    return { provider: this.name, orderId: order.orderId };
  }

  verify(clientId: string, userId: string, allocationId: string, body: unknown) {
    return this.deployment.verify(clientId, userId, allocationId, body);
  }
}
