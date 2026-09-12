import {
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFeatureUsageDto {
  @IsString() subscriptionId!: string;
  @IsString() featureId!: string;
  @IsOptional() @IsString() @MaxLength(150) usageReference?: string;
  @IsOptional() @IsNumber() @Min(0.0001) quantity?: number;
  @IsDateString() usageTimestamp!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
