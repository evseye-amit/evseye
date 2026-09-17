import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Gender } from '@prisma/client';
import { INDIAN_MOBILE_INPUT_PATTERN } from '../../common/phone.js';

export class CreateRiderDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @Matches(INDIAN_MOBILE_INPUT_PATTERN)
  mobile!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(50) riderCode?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(255) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(10) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(150) emergencyContactName?: string;
  @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/) emergencyContactMobile?: string;
}

export class BulkRiderDto {
  @IsString() @MaxLength(255) filename!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateRiderDto)
  rows!: CreateRiderDto[];
}
