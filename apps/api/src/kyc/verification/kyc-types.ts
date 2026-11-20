import type { KycVerificationStatus, KycVerificationType, KycProviderCode, KycProviderEnvironment } from '@prisma/client';

export interface VerificationInput {
  type: KycVerificationType;
  pan?: string;
  name?: string;
  dateOfBirth?: string;
  aadhaar?: string;
  accountNumber?: string;
  ifsc?: string;
  reason?: string;
  timeoutMs?: number;
}

export interface ProviderResult {
  status: KycVerificationStatus;
  providerReference?: string;
  transactionId?: string;
  data: Record<string, string | boolean | null>;
  failureCode?: string;
  failureType?: 'BUSINESS_FAILURE' | 'TECHNICAL_FAILURE';
  failureCategory?: string;
}

export interface VerificationProvider {
  readonly code: KycProviderCode;
  /** Fail closed when a configured credential cannot be resolved by this adapter. */
  acceptsCredential(environment: KycProviderEnvironment, secretReference: string): boolean;
  supports(type: KycVerificationType): boolean;
  verify(input: VerificationInput): Promise<ProviderResult>;
  completeAadhaarOtp(reference: string, otp: string, timeoutMs?: number): Promise<ProviderResult>;
  health(): Promise<'AVAILABLE' | 'UNAVAILABLE'>;
  circuitOpen?(): boolean;
}
