import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  IsNumber,
  ValidateNested,
} from 'class-validator';

const currency = /^[A-Z]{3}$/;

export class CreateRideReturnDto {
  @IsOptional() @IsUUID() riderId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) reasonCode?: string;
  @IsOptional() @IsUUID() plannedHubId?: string;
  @IsISO8601() plannedReturnDate!: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ListRideReturnsDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsUUID() hubId?: string;
}

export class ReceiveRideReturnDto {
  @IsUUID() receivedHubId!: string;
  @IsOptional() @IsISO8601() receivedAt?: string;
  @IsOptional() @IsString() @MaxLength(500) backdateReason?: string;
}

export class ReturnPenaltyItemDto {
  @IsUUID() priceId!: string;
  @IsString() @MaxLength(1000) details!: string;
  @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true }) evidencePhotoIds!: string[];
}

export class ReplaceReturnPenaltiesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReturnPenaltyItemDto)
  items!: ReturnPenaltyItemDto[];
}

export class DisputeReturnPenaltyDto {
  @IsString() @MaxLength(500) reason!: string;
}

export class ReturnPenaltyPriceDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,59}$/) code!: string;
  @IsIn(['DAMAGE', 'MISSING_ITEM']) category!: 'DAMAGE' | 'MISSING_ITEM';
  @IsString() @MaxLength(300) description!: string;
  @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/) amount!: string;
  @IsString() @Matches(currency) currency!: string;
}

export class UpdateReturnPenaltyPriceDto {
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/) amount?: string;
  @IsOptional() @IsString() @Matches(currency) currency?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
