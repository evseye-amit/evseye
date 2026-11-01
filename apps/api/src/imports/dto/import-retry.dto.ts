import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

export class RiderRetryRowDto {
  @IsString() name!: string;
  @IsString() mobile!: string;
  @IsOptional() @IsString() riderCode?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
}
export class RiderImportRetryDto { @IsArray() @ValidateNested({ each: true }) @Type(() => RiderRetryRowDto) rows!: RiderRetryRowDto[]; }

export class HubRetryRowDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() type!: string;
  @IsString() status!: string;
  @IsString() city!: string;
  @IsString() state!: string;
  @IsString() @Matches(/^\d{4,10}$/) postalCode!: string;
}
export class HubImportRetryDto { @IsArray() @ValidateNested({ each: true }) @Type(() => HubRetryRowDto) rows!: HubRetryRowDto[]; }

export class FleetRetryRowDto {
  @IsString() vehicleNumber!: string;
  @IsString() chassisNumber!: string;
  @IsOptional() @IsString() oemCode?: string;
  @IsOptional() @IsString() vehicleCategoryCode?: string;
  @IsOptional() @IsString() vehicleTypeCode?: string;
  @IsOptional() @IsString() homeHubCode?: string;
}
export class FleetImportRetryDto { @IsArray() @ValidateNested({ each: true }) @Type(() => FleetRetryRowDto) rows!: FleetRetryRowDto[]; }

export class TeamLeaderRetryRowDto {
  @IsString() name!: string;
  @IsString() mobile!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() employeeCode?: string;
  @IsOptional() @IsString() designation?: string;
}
export class TeamLeaderImportRetryDto { @IsArray() @ValidateNested({ each: true }) @Type(() => TeamLeaderRetryRowDto) rows!: TeamLeaderRetryRowDto[]; }

export class FleetManagerRetryRowDto {
  @IsString() name!: string;
  @IsString() mobile!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() primaryHubCode?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) hubCodes?: string[];
}
export class FleetManagerImportRetryDto { @IsArray() @ValidateNested({ each: true }) @Type(() => FleetManagerRetryRowDto) rows!: FleetManagerRetryRowDto[]; }
