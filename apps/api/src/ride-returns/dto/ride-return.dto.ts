import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  IsNumber,
} from 'class-validator';

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
