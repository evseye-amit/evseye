import { FleetStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ChangeFleetStatusDto {
  @IsEnum(FleetStatus)
  status!: FleetStatus;
}
