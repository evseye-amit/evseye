import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import type { Environment } from '../config/environment.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { KYC_PROVIDER } from './providers/kyc-provider.interface.js';
import { SandboxKycProvider } from './providers/sandbox-kyc.provider.js';
import { ReferralModule } from '../referrals/referral.module.js';

@Module({
  imports: [AuthModule, AuditModule, ReferralModule],
  controllers: [KycController],
  providers: [
    KycService,
    SandboxKycProvider,
    {
      provide: KYC_PROVIDER,
      inject: [ConfigService, SandboxKycProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        sandbox: SandboxKycProvider,
      ) => {
        const provider = config.getOrThrow('KYC_PROVIDER');
        if (provider === 'sandbox') return sandbox;
        throw new Error(`Unsupported KYC_PROVIDER: ${provider}`);
      },
    },
  ],
})
export class KycModule {}
