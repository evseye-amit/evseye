import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateClientFeaturePricingDto {
  @IsString() featurePricingId!: string;
  @IsOptional() @IsIn(['FIXED_AMOUNT', 'PERCENTAGE']) discountType?: string;
  @IsOptional() @IsNumber() @Min(0) discountValue?: number;
  @IsOptional() @IsNumber() @Min(0) setupFee?: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class UpdateClientFeaturePricingDto {
  @IsOptional() @IsIn(['FIXED_AMOUNT', 'PERCENTAGE']) discountType?: string;
  @IsOptional() @IsNumber() @Min(0) discountValue?: number;
  @IsOptional() @IsNumber() @Min(0) setupFee?: number;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
