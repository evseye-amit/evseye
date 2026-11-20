import { Global, Module } from '@nestjs/common';
import { PaymentGatewayPolicyService } from './payment-gateway-policy.service.js';
import { DeploymentAutoPayPolicyService } from './deployment-autopay-policy.service.js';

@Global()
@Module({ providers: [PaymentGatewayPolicyService, DeploymentAutoPayPolicyService], exports: [PaymentGatewayPolicyService, DeploymentAutoPayPolicyService] })
export class PaymentGatewayPolicyModule {}
