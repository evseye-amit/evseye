import { Global, Module } from '@nestjs/common';
import { PaymentGatewayPolicyService } from './payment-gateway-policy.service.js';
import { AutoPayAvailabilityService } from './autopay-availability.service.js';

@Global()
@Module({ providers: [PaymentGatewayPolicyService, AutoPayAvailabilityService], exports: [PaymentGatewayPolicyService, AutoPayAvailabilityService] })
export class PaymentGatewayPolicyModule {}
