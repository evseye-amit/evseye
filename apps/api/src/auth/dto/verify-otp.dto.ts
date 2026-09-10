import { IsString, IsUUID, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsUUID()
  otpRequestId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
