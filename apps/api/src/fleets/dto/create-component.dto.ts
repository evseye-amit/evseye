import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BatteryChemistry, BatterySlot, BatteryType } from '@prisma/client';

export class CreateBatteryDto {
  @IsString() @MaxLength(80) serialNumber!: string;
  @IsOptional() @IsString() @MaxLength(50) batteryCode?: string;
  @IsOptional() @IsEnum(BatteryType) batteryType?: BatteryType;
  @IsOptional() @IsEnum(BatterySlot) batterySlot?: BatterySlot;
  @IsOptional() @IsString() @MaxLength(100) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsEnum(BatteryChemistry) chemistry?: BatteryChemistry;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  capacityKwh?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  voltage?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ampHour?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  installedOdometerKm?: number;
  @IsOptional() @IsDateString() manufacturingDate?: string;
  @IsOptional() @IsDateString() warrantyStartDate?: string;
  @IsOptional() @IsDateString() warrantyEndDate?: string;
}

export class CreateControllerDto {
  @IsString() @MaxLength(100) controllerNumber!: string;
  @IsOptional() @IsString() @MaxLength(100) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ratedVoltage?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ratedCurrent?: number;
}
