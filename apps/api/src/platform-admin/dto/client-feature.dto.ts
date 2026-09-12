import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ClientFeatureSource } from '@prisma/client';

export class CreateClientFeatureDto {
  @IsString() subscriptionId!: string;
  @IsString() featureId!: string;
  @IsOptional() @IsEnum(ClientFeatureSource) source?: ClientFeatureSource;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) includedQuantity?: number;
  @IsOptional() @IsNumber() @Min(0) usageLimit?: number;
  @IsOptional() @IsBoolean() unlimitedUsage?: boolean;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}

export class UpdateClientFeatureDto {
  @IsOptional() @IsEnum(ClientFeatureSource) source?: ClientFeatureSource;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) includedQuantity?: number;
  @IsOptional() @IsNumber() @Min(0) usageLimit?: number;
  @IsOptional() @IsBoolean() unlimitedUsage?: boolean;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}
