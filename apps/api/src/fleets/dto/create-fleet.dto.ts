import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
export class CreateFleetDto {
  @IsString() @MaxLength(40) vehicleNumber!: string;
  @IsString() @MaxLength(80) chassisNumber!: string;
  @IsOptional() @IsUUID() hubId?: string;
  @IsOptional() @IsString() @MaxLength(80) oem?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsString() @MaxLength(40) colour?: string;
  @IsOptional() @IsString() @MaxLength(40) vehicleType?: string;
  @IsOptional() @IsString() @MaxLength(80) motorNumber?: string;
  @IsOptional() @IsISO8601() registrationDate?: string;
  @IsOptional() @IsISO8601() insuranceStartDate?: string;
  @IsOptional() @IsISO8601() insuranceEndDate?: string;
  @IsOptional() @IsISO8601() fitnessRenewalDate?: string;
}
