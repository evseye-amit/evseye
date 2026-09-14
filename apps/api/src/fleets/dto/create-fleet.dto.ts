import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import {
  FleetOwnershipType,
  FleetStatus,
  InsuranceType,
  VehicleSpeedType,
} from '@prisma/client';
export class CreateFleetDto {
  @IsOptional() @IsString() @MaxLength(50) fleetCode?: string;
  @IsOptional() @IsString() @MaxLength(30) vehicleNumber?: string;
  @IsString() @MaxLength(80) chassisNumber!: string;
  @IsOptional() @IsString() @MaxLength(100) vinNumber?: string;
  @IsUUID() oemId!: string;
  @IsUUID() vehicleCategoryId!: string;
  @IsUUID() vehicleTypeId!: string;
  @IsEnum(VehicleSpeedType) speedType!: VehicleSpeedType;
  @IsOptional() @IsUUID() homeHubId?: string;
  @IsOptional() @IsUUID() currentHubId?: string;
  @IsOptional() @IsString() @MaxLength(100) modelName?: string;
  @IsOptional() @IsString() @MaxLength(100) variantName?: string;
  @IsOptional() @IsString() @MaxLength(50) colour?: string;
  @IsOptional() @IsString() @MaxLength(80) motorNumber?: string;
  @IsOptional() @IsInt() @Min(1900) @Max(2100) manufacturingYear?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) manufacturingMonth?: number;
  @IsOptional() @IsEnum(FleetOwnershipType) ownershipType?: FleetOwnershipType;
  @IsOptional() @IsEnum(FleetStatus) status?: FleetStatus;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  odometerKm?: number;
  @IsOptional() @IsISO8601() registrationDate?: string;
  @IsOptional() @IsString() @MaxLength(150) registeringAuthority?: string;
  @IsOptional() @IsISO8601() rcExpiryDate?: string;
  @IsOptional() @IsString() @MaxLength(150) insuranceProviderName?: string;
  @IsOptional() @IsString() @MaxLength(100) insurancePolicyNumber?: string;
  @IsOptional() @IsEnum(InsuranceType) insuranceType?: InsuranceType;
  @IsOptional() @IsISO8601() insuranceStartDate?: string;
  @IsOptional() @IsISO8601() insuranceEndDate?: string;
  @IsOptional() @IsString() @MaxLength(100) fitnessCertificateNumber?: string;
  @IsOptional() @IsISO8601() fitnessExpiryDate?: string;
}
