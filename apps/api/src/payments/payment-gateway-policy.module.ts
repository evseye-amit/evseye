import { Global, Module } from '@nestjs/common';
import { PaymentGatewayPolicyService } from './payment-gateway-policy.service.js';

@Global()
@Module({ providers: [PaymentGatewayPolicyService], exports: [PaymentGatewayPolicyService] })
export class PaymentGatewayPolicyModule {}
