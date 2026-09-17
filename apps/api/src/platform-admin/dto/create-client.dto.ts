import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { INDIAN_MOBILE_INPUT_PATTERN } from '../../common/phone.js';

export class CreateClientDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(80) slug!: string;
  @IsOptional() @IsEmail() adminEmail?: string;
  @IsString() @MaxLength(120) adminName!: string;
  @IsString() @Matches(INDIAN_MOBILE_INPUT_PATTERN) adminMobile!: string;
}
