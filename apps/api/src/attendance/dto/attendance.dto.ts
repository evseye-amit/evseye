import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ListAttendanceDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class AddAttendancePeriodDto {
  @IsDateString()
  checkInAt!: string;

  @IsDateString()
  checkOutAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/)
  reason!: string;
}

export class CorrectAttendancePeriodDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  checkInAt?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString()
  checkOutAt?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/)
  reason!: string;
}
