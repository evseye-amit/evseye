import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertClientPaymentProviderDto {
  @IsIn(['RAZORPAY']) provider!: 'RAZORPAY';
  @IsIn(['TEST', 'PRODUCTION']) environment!: 'TEST' | 'PRODUCTION';
  @IsString() @MaxLength(128) keyId!: string;
  @IsString() @MaxLength(512) secretReference!: string;
  @IsOptional() @IsString() @MaxLength(128) merchantAccountId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}
