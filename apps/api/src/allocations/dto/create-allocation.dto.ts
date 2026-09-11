import { IsUUID } from 'class-validator';

export class CreateAllocationDto {
  @IsUUID()
  fleetId!: string;

  @IsUUID()
  riderId!: string;
}
