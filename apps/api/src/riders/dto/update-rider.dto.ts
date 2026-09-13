import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateRiderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsIn(['ONBOARDING', 'ACTIVE', 'INACTIVE', 'BLOCKED', 'EXITED'])
  status?: 'ONBOARDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'EXITED';
}
