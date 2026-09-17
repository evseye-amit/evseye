import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Gender } from '@prisma/client';
import { INDIAN_MOBILE_INPUT_PATTERN } from '../../common/phone.js';

export class UpdateRiderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(INDIAN_MOBILE_INPUT_PATTERN)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  riderCode?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  emergencyContactName?: string;

  @IsOptional()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  emergencyContactMobile?: string;

  @IsOptional()
  @IsIn(['ONBOARDING', 'ACTIVE', 'INACTIVE', 'BLOCKED', 'EXITED'])
  status?: 'ONBOARDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'EXITED';
}
