import { Injectable } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import type {
  KycProvider,
  KycVerificationRequest,
  KycVerificationResult,
} from './kyc-provider.interface.js';

@Injectable()
export class ManualKycProvider implements KycProvider {
  async start(_input: KycVerificationRequest): Promise<KycVerificationResult> {
    return {
      status: KycStatus.PENDING,
      provider: 'EVSEYE_MANUAL',
    };
  }
}
