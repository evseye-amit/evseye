import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsUUID()
  otpRequestId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(RIDER_APP|CLIENT_PANEL|FLEET_MANAGER_APP|TEAM_LEADER_APP)$/)
  appCode?: string;
}
