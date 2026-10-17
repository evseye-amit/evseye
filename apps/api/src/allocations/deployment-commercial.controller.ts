import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { DeploymentCommercialService } from './deployment-commercial.service.js';

export class DeploymentPlansQuery {
  @IsOptional() @IsUUID() batteryPlanId?: string;
}

@Controller('mobile-deployments')
@ApiTags('Fleet Manager · Allocation Plans')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
export class DeploymentCommercialController {
  constructor(
    private readonly commercial: DeploymentCommercialService,
    private readonly clients: ClientContextService,
  ) {}
  @Get(':id/plans')
  @Roles(UserRole.FLEET_MANAGER)
  @ApiOperation({
    summary:
      'List eligible rental plans with calculated deposit, onboarding fees and total',
  })
  async plans(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeploymentPlansQuery,
  ) {
    return {
      data: await this.commercial.plans(
        this.clients.requireClientId(user),
        user,
        id,
        query.batteryPlanId,
      ),
    };
  }
  @Post(':id/commercial-offer')
  @Roles(UserRole.FLEET_MANAGER)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Select and present a rental plan for rider acceptance',
  })
  async create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return {
      data: await this.commercial.createOffer(
        this.clients.requireClientId(user),
        user,
        id,
        body,
        key,
      ),
    };
  }
  @Get(':id/commercial-offer')
  @Roles(UserRole.FLEET_MANAGER, UserRole.RIDER)
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.commercial.getOffer(
        this.clients.requireClientId(user),
        user,
        id,
        user.roles.includes(UserRole.RIDER) &&
          !user.roles.includes(UserRole.FLEET_MANAGER),
      ),
    };
  }
}
