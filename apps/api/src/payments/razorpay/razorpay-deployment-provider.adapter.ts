import { Injectable } from '@nestjs/common';
import type {
  DeploymentPaymentOrder,
  DeploymentPaymentProvider,
} from '../deployment-payment-provider.interface.js';
import { RazorpayDeploymentService } from './razorpay-deployment.service.js';

@Injectable()
export class RazorpayDeploymentProviderAdapter
  implements DeploymentPaymentProvider
{
  readonly name = 'RAZORPAY';

  constructor(private readonly deployment: RazorpayDeploymentService) {}

  async createOrder(
    clientId: string,
    userId: string,
    allocationId: string,
  ): Promise<DeploymentPaymentOrder> {
    const order = await this.deployment.createOrder(clientId, userId, allocationId);
    return { provider: this.name, orderId: order.orderId };
  }

  verify(clientId: string, userId: string, allocationId: string, body: unknown) {
    return this.deployment.verify(clientId, userId, allocationId, body);
  }
}
