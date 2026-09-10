import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class StartKycDto {
  @IsIn(['AADHAAR', 'PAN', 'BANK_ACCOUNT'])
  type!: 'AADHAAR' | 'PAN' | 'BANK_ACCOUNT';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceHint?: string;
}
