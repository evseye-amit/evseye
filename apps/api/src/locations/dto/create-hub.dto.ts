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
import { Transform } from 'class-transformer';
import { HubStatus, HubType } from '@prisma/client';

const optionalNumber = () =>
  Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : Number(value),
  );
const optionalBoolean = () =>
  Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return String(value).trim().toLowerCase() === 'true';
  });

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
  @IsOptional() @optionalNumber() @IsNumber() latitude?: number;
  @IsOptional() @optionalNumber() @IsNumber() longitude?: number;
  @IsOptional() @IsUUID() parentHubId?: string;
  @IsOptional() @optionalNumber() @IsInt() @Min(0) vehicleCapacity?: number;
  @IsOptional() @optionalNumber() @IsInt() @Min(0) riderCapacity?: number;
  @IsOptional() @optionalNumber() @IsInt() @Min(0) batteryCapacity?: number;
  @IsOptional() @optionalNumber() @IsInt() @Min(0) parkingSlots?: number;
  @IsOptional() @optionalNumber() @IsInt() @Min(0) chargingPoints?: number;
  @IsOptional() @optionalNumber() @IsInt() @Min(0) swappingPoints?: number;
  @IsOptional() @IsString() @MaxLength(150) contactName?: string;
  @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/) contactPhone?: string;
  @IsOptional() @IsEmail() @MaxLength(150) contactEmail?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) openingTime?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) closingTime?: string;
  @IsOptional() @optionalBoolean() @IsBoolean() is24x7?: boolean;
  @IsOptional() @optionalBoolean() @IsBoolean() supportsCharging?: boolean;
  @IsOptional()
  @optionalBoolean()
  @IsBoolean()
  supportsBatterySwapping?: boolean;
  @IsOptional() @optionalBoolean() @IsBoolean() supportsMaintenance?: boolean;
  @IsOptional() @optionalBoolean() @IsBoolean() supportsAllocation?: boolean;
  @IsOptional() @optionalBoolean() @IsBoolean() supportsDeallocation?: boolean;
  @IsOptional() @optionalBoolean() @IsBoolean() supportsPdi?: boolean;
}
