import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListAllocationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(['INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING', 'ACTIVE', 'DEALLOCATION_INITIATED', 'COMPLETED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsString()
  riderId?: string;

  @IsOptional()
  @IsString()
  fleetId?: string;
}
