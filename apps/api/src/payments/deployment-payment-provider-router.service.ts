import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  DeploymentPaymentOrder,
  DeploymentPaymentProvider,
} from './deployment-payment-provider.interface.js';

@Injectable()
export class DeploymentPaymentProviderRouter {
  private readonly providers: ReadonlyMap<string, DeploymentPaymentProvider>;

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    razorpay: DeploymentPaymentProvider,
  ) {
    this.providers = new Map([[razorpay.name, razorpay]]);
  }

  async createOrder(
    clientId: string,
    userId: string,
    allocationId: string,
  ): Promise<DeploymentPaymentOrder> {
    const environment = this.config.getOrThrow('RAZORPAY_ENVIRONMENT');
    const configured = await this.db.clientPaymentProvider.findFirst({
      where: {
        clientId,
        environment,
        status: 'ACTIVE',
        validFrom: { lte: new Date() },
        OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { provider: true },
    });
    const providerName = configured?.provider?.trim().toUpperCase();
    if (!providerName)
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
        message: 'No active online payment provider is configured for this workspace.',
      });
    const provider = this.providers.get(providerName);
    if (!provider)
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_UNSUPPORTED',
        message: `The configured deployment payment provider ${providerName} is not supported.`,
      });
    return provider.createOrder(clientId, userId, allocationId);
  }

  async verify(clientId: string, userId: string, allocationId: string, body: unknown) {
    const attempt = await this.db.deploymentPaymentAttempt.findFirst({
      where: { clientId, payment: { workflow: { allocationId, allocation: { clientId } } } },
      orderBy: { createdAt: 'desc' },
      select: { provider: true },
    });
    const provider = attempt && this.providers.get(attempt.provider.toUpperCase());
    if (!provider)
      throw new ServiceUnavailableException({
        code: attempt ? 'PAYMENT_PROVIDER_UNSUPPORTED' : 'PAYMENT_PROVIDER_UNAVAILABLE',
        message: attempt ? `The deployment payment provider ${attempt.provider} is not supported.` : 'No deployment payment attempt exists.',
      });
    return provider.verify(clientId, userId, allocationId, body);
  }
}
