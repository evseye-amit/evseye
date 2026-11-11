import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class ResendLoginOtpDto {
  @IsUUID()
  otpRequestId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(PLATFORM|RIDER_APP|CLIENT_PANEL|FLEET_MANAGER_APP|TEAM_LEADER_APP)$/)
  appCode?: string;
}
