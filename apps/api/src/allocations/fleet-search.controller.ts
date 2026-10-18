import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FleetStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { FleetSearchService } from './fleet-search.service.js';
export class FleetSearchQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() hubId?: string;
  @IsOptional() @IsEnum(FleetStatus) status?: FleetStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
@Controller('mobile-deployments/fleet-manager/fleets')
@ApiTags('Fleet Manager · Global Scooter Search')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.FLEET_MANAGER)
export class FleetSearchController {
  constructor(
    private readonly service: FleetSearchService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query() query: FleetSearchQueryDto) {
    return this.service.search(
      this.clients.requireClientId(user),
      user.id,
      query,
    );
  }
  @Get(':fleetId')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('fleetId', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.service.get(
        this.clients.requireClientId(user),
        user.id,
        id,
      ),
    };
  }
}
