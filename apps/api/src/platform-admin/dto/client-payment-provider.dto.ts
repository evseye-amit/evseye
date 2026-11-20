import { IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class UpsertClientPaymentProviderDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,31}$/) provider!: string;
  @IsIn(['TEST', 'PRODUCTION']) environment!: 'TEST' | 'PRODUCTION';
  @IsString() @MaxLength(128) keyId!: string;
  @IsString() @MaxLength(512) secretReference!: string;
  @IsOptional() @IsString() @MaxLength(128) merchantAccountId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
  /** Omit only for legacy callers; NEW asserts that no configuration exists. */
  @IsOptional() @IsString() @MaxLength(40) expectedRevision?: string;
}
