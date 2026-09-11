import { Injectable } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  KycProvider,
  KycVerificationRequest,
  KycVerificationResult,
} from './kyc-provider.interface.js';

@Injectable()
export class SandboxKycProvider implements KycProvider {
  async start(_input: KycVerificationRequest): Promise<KycVerificationResult> {
    return {
      status: KycStatus.PENDING,
      provider: 'sandbox',
      providerReference: `sandbox-${randomUUID()}`,
    };
  }
}
