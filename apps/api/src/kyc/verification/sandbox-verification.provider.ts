import { BadRequestException, Injectable } from '@nestjs/common';
import { KycProviderCode, KycVerificationType } from '@prisma/client';
import { maskLastFour, maskPan } from './kyc-security.js';
import type { ProviderResult, VerificationInput, VerificationProvider } from './kyc-types.js';
import { isRecord, SandboxHttpError, SandboxHttpService } from './sandbox-http.service.js';

function payload(response: unknown): { data: Record<string, unknown>; transactionId?: string } {
  if (!isRecord(response)) throw new SandboxHttpError('PROVIDER_ERROR');
  const data = isRecord(response.data) ? response.data : response;
  if (!isRecord(data)) throw new SandboxHttpError('PROVIDER_ERROR');
  return { data, transactionId: typeof response.transaction_id === 'string' ? response.transaction_id : undefined };
}

@Injectable()
export class SandboxVerificationProvider implements VerificationProvider {
  readonly code = KycProviderCode.SANDBOX;
  constructor(private readonly http: SandboxHttpService) {}

  supports(type: KycVerificationType): boolean {
    return type === KycVerificationType.PAN_VERIFICATION || type === KycVerificationType.AADHAAR_OTP ||
      type === KycVerificationType.IFSC_VERIFICATION;
  }

  async verify(input: VerificationInput): Promise<ProviderResult> {
    switch (input.type) {
      case KycVerificationType.PAN_VERIFICATION: {
        if (!input.pan || !input.name || !input.dateOfBirth || !input.reason) throw new BadRequestException('PAN verification details are required.');
        const { data, transactionId } = payload(await this.http.request('/kyc/pan/verify', 'POST', {
          '@entity': 'in.co.sandbox.kyc.pan_verification.request', pan: input.pan,
          name_as_per_pan: input.name, date_of_birth: input.dateOfBirth, consent: 'Y', reason: input.reason,
        }, input.timeoutMs));
        if (typeof data.status !== 'string') throw new SandboxHttpError('PROVIDER_ERROR');
        const verified = data.status.toLowerCase() === 'valid' && data.name_as_per_pan_match === true && data.date_of_birth_match === true;
        return { status: verified ? 'VERIFIED' : 'FAILED', transactionId, data: {
          maskedPan: maskPan(input.pan), panStatus: data.status,
          nameMatch: data.name_as_per_pan_match === true, dateOfBirthMatch: data.date_of_birth_match === true,
        }, ...(verified ? {} : { failureType: 'BUSINESS_FAILURE', failureCategory: 'IDENTITY_MISMATCH', failureCode: 'PAN_NOT_VERIFIED' }) };
      }
      case KycVerificationType.AADHAAR_OTP: {
        if (!input.aadhaar || !input.reason) throw new BadRequestException('Aadhaar verification details are required.');
        const { data, transactionId } = payload(await this.http.request('/kyc/aadhaar/okyc/otp', 'POST', {
          '@entity': 'in.co.sandbox.kyc.aadhaar.okyc.otp.request', aadhaar_number: input.aadhaar,
          consent: 'Y', reason: input.reason,
        }, input.timeoutMs));
        if (typeof data.reference_id !== 'string' && typeof data.reference_id !== 'number') throw new SandboxHttpError('PROVIDER_ERROR');
        return { status: 'OTP_REQUIRED', providerReference: String(data.reference_id), transactionId,
          data: { maskedAadhaar: maskLastFour(input.aadhaar) } };
      }
      case KycVerificationType.IFSC_VERIFICATION: {
        if (!input.ifsc) throw new BadRequestException('IFSC is required.');
        const { data, transactionId } = payload(await this.http.request(`/bank/${input.ifsc}`, 'GET', undefined, input.timeoutMs));
        if (typeof data.IFSC !== 'string') throw new SandboxHttpError('PROVIDER_ERROR');
        return { status: 'VERIFIED', transactionId, data: {
          ifsc: data.IFSC, bank: typeof data.BANK === 'string' ? data.BANK : null,
          branch: typeof data.BRANCH === 'string' ? data.BRANCH : null,
        } };
      }
      default: throw new BadRequestException('KYC_FEATURE_NOT_ENABLED');
    }
  }

  async completeAadhaarOtp(reference: string, otp: string, timeoutMs?: number): Promise<ProviderResult> {
    const { data, transactionId } = payload(await this.http.request('/kyc/aadhaar/okyc/otp/verify', 'POST', {
      '@entity': 'in.co.sandbox.kyc.aadhaar.okyc.request', reference_id: reference, otp,
    }, timeoutMs));
    if (typeof data.status !== 'string') throw new SandboxHttpError('PROVIDER_ERROR');
    const verified = data.status.toUpperCase() === 'VALID';
    return { status: verified ? 'VERIFIED' : 'FAILED', transactionId,
      data: { identityVerified: verified },
      ...(verified ? {} : { failureType: 'BUSINESS_FAILURE', failureCategory: 'OTP_FAILED', failureCode: 'AADHAAR_OTP_INVALID' }) };
  }

  health() { return this.http.health(); }
  circuitOpen() { return this.http.circuitOpen(); }
}
