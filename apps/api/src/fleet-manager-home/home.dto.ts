import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class FleetManagerHomeQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'An active hub assigned to the signed-in Fleet Manager. Defaults to the primary hub.',
  })
  @IsOptional()
  @IsUUID()
  hubId?: string;
}
