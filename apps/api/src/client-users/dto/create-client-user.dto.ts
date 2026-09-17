import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateFleetManagerDto {
  @IsString() @MaxLength(150) name!: string;
  @Matches(/^\+?[1-9]\d{7,14}$/) mobile!: string;
  @IsOptional() @IsEmail() @MaxLength(150) email?: string;
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) hubIds!: string[];
  @IsUUID() primaryHubId!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BulkFleetManagerDto {
  @IsString() @MaxLength(255) filename!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateFleetManagerDto)
  rows!: CreateFleetManagerDto[];
}

export class CreateTeamLeaderDto {
  @IsString() @MaxLength(150) name!: string;
  @Matches(/^\+?[1-9]\d{7,14}$/) mobile!: string;
  @IsOptional() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @IsString() @MaxLength(50) employeeCode?: string;
  @IsOptional() @IsString() @MaxLength(100) designation?: string;
}

export class BulkTeamLeaderDto {
  @IsString() @MaxLength(255) filename!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateTeamLeaderDto)
  rows!: CreateTeamLeaderDto[];
}

export class AssignTeamLeaderRidersDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  riderIds!: string[];
  @IsOptional() isPrimary?: boolean;
}
