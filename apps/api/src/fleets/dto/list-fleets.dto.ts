import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { FleetOnboardingStatus, FleetStatus } from '@prisma/client';
export class ListFleetsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() search?: string;
  @IsOptional()
  @IsOptional()
  @IsEnum(FleetStatus)
  status?: FleetStatus;
  @IsOptional()
  @IsEnum(FleetOnboardingStatus)
  onboardingStatus?: FleetOnboardingStatus;
  @IsOptional() @IsUUID() oemId?: string;
  @IsOptional() @IsUUID() vehicleCategoryId?: string;
  @IsOptional() @IsUUID() vehicleTypeId?: string;
  @IsOptional() @IsUUID() hubId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isAllocatable?: boolean;
}
