import { IsUUID } from 'class-validator';

export class StartFleetTransferDto {
  @IsUUID() destinationHubId!: string;
}
