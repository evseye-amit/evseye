import { FleetStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChangeFleetStatusDto {
  @IsEnum(FleetStatus)
  status!: FleetStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
