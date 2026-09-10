import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteKycDto {
  @IsIn(['VERIFIED', 'FAILED', 'RETRY_REQUIRED'])
  status!: 'VERIFIED' | 'FAILED' | 'RETRY_REQUIRED';

  @IsOptional()
  @IsObject()
  maskedData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  safeFailureCode?: string;
}
