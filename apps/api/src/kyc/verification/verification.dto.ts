import { KycVerificationType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateConsentDto {
  @IsUUID() riderId!: string;
  @IsEnum(KycVerificationType) verificationType!: KycVerificationType;
  @IsString() @MaxLength(40) consentVersion!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/i) consentTextHash!: string;
  @IsString() @MinLength(20) @MaxLength(500) purpose!: string;
  @IsString() @MinLength(20) @MaxLength(500) reason!: string;
  @IsBoolean() accepted!: boolean;
  @IsString() @MaxLength(40) channel!: string;
}

export class StartVerificationDto {
  @IsUUID() riderId!: string;
  @IsEnum(KycVerificationType) type!: KycVerificationType;
  @IsOptional() @IsUUID() consentId?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/) pan?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @IsOptional() @IsString() @Matches(/^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/) dateOfBirth?: string;
  @IsOptional() @IsString() @Matches(/^\d{12}$/) aadhaar?: string;
  @IsOptional() @IsString() @Matches(/^\d{6,40}$/) accountNumber?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{4}[A-Z0-9]{7}$/) ifsc?: string;
}

export class CompleteAadhaarOtpDto {
  @IsString() @Matches(/^\d{6}$/) otp!: string;
}
