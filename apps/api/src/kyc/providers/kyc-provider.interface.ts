import type { KycStatus, KycType } from '@prisma/client';

export interface KycVerificationRequest {
  tenantId: string;
  riderId: string;
  type: KycType;
  referenceHint?: string;
}

export interface KycVerificationResult {
  status: KycStatus;
  provider: string;
  providerReference?: string;
  maskedData?: Record<string, unknown>;
  safeFailureCode?: string;
}

export interface KycProvider {
  start(input: KycVerificationRequest): Promise<KycVerificationResult>;
}

export interface AadhaarVerificationProvider extends KycProvider {}
export interface PanVerificationProvider extends KycProvider {}
export interface BankVerificationProvider extends KycProvider {}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
