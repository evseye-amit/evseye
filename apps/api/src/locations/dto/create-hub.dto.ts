import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { HubStatus, HubType } from '@prisma/client';

export class CreateHubDto {
  @IsString() @MaxLength(150) name!: string;
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(50) code!: string;
  @IsOptional() @IsEnum(HubType) type?: HubType;
  @IsOptional() @IsEnum(HubStatus) status?: HubStatus;
  @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(255) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(150) landmark?: string;
  @IsString() @MaxLength(100) city!: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsString() @MaxLength(100) state!: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsString() @MaxLength(10) postalCode?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsUUID() parentHubId?: string;
  @IsOptional() @IsInt() @Min(0) vehicleCapacity?: number;
  @IsOptional() @IsInt() @Min(0) riderCapacity?: number;
  @IsOptional() @IsInt() @Min(0) batteryCapacity?: number;
  @IsOptional() @IsInt() @Min(0) parkingSlots?: number;
  @IsOptional() @IsInt() @Min(0) chargingPoints?: number;
  @IsOptional() @IsInt() @Min(0) swappingPoints?: number;
  @IsOptional() @IsString() @MaxLength(150) contactName?: string;
  @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/) contactPhone?: string;
  @IsOptional() @IsEmail() @MaxLength(150) contactEmail?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) openingTime?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) closingTime?: string;
  @IsOptional() @IsBoolean() is24x7?: boolean;
  @IsOptional() @IsBoolean() supportsCharging?: boolean;
  @IsOptional() @IsBoolean() supportsBatterySwapping?: boolean;
  @IsOptional() @IsBoolean() supportsMaintenance?: boolean;
  @IsOptional() @IsBoolean() supportsAllocation?: boolean;
  @IsOptional() @IsBoolean() supportsDeallocation?: boolean;
  @IsOptional() @IsBoolean() supportsPdi?: boolean;
}
