import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class RequestLoginOtpDto {
  @IsString()
  @Matches(/^(?:[6-9]\d{9}|0[6-9]\d{9}|\+91[6-9]\d{9})$/)
  phone!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(80)
  companyCode?: string;

  /** @deprecated Use companyCode. Retained temporarily for existing clients. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(80)
  clientSlug?: string;
}
