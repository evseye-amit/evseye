import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MaintenanceFleetsQueryDto {
  @IsOptional() @IsIn(['MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'])
  fleetStatus?: 'MAINTENANCE' | 'BROKEN' | 'AWAITING_PARTS';
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'An active assigned hub. Omit to list across all active assigned hubs.',
  })
  @IsOptional()
  @IsUUID()
  hubId?: string;
  @ApiPropertyOptional({
    description: 'Vehicle number, fleet code, chassis number or model.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
