import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { AllocationTeamLeadService } from './allocation-team-lead.service.js';
export class TeamLeadQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
export class AssignAllocationTeamLeadDto {
  @IsUUID() teamLeaderId!: string;
}
@Controller('mobile-deployments')
@ApiTags('Fleet Manager · Team Lead Assignment')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.FLEET_MANAGER)
export class AllocationTeamLeadController {
  constructor(
    private readonly service: AllocationTeamLeadService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('fleet-manager/team-leads')
  list(@CurrentUser() user: AuthUser, @Query() query: TeamLeadQueryDto) {
    return this.service.list(
      this.clients.requireClientId(user),
      query.search,
      query.page,
      query.limit,
    );
  }
  @Get(':id/team-lead')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.service.get(
        this.clients.requireClientId(user),
        user.id,
        id,
      ),
    };
  }
  @Put(':id/team-lead')
  async assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignAllocationTeamLeadDto,
  ) {
    return {
      data: await this.service.assign(
        this.clients.requireClientId(user),
        user.id,
        id,
        body.teamLeaderId,
      ),
    };
  }
}
