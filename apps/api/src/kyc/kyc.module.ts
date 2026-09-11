import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { KYC_PROVIDER } from './providers/kyc-provider.interface.js';
import { SandboxKycProvider } from './providers/sandbox-kyc.provider.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [KycController],
  providers: [
    KycService,
    SandboxKycProvider,
    { provide: KYC_PROVIDER, useExisting: SandboxKycProvider },
  ],
})
export class KycModule {}
