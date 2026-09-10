import { IsString, Matches, MaxLength } from 'class-validator';

export class RequestLoginOtpDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(80)
  tenantSlug!: string;
}
