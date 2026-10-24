import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { SubmissionPenaltyService } from './submission-penalty.service.js';
export class PenaltyPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsIn(['PENDING', 'ALL']) status: 'PENDING' | 'ALL' = 'PENDING';
}
export class PenaltyExceptionDto {
  @IsString() @MaxLength(500) reason!: string;
}
@Controller('rider-app/submission-penalties')
@ApiBearerAuth()
@ApiTags('Rider submission penalty payments')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderSubmissionPenaltyController {
  constructor(
    private readonly service: SubmissionPenaltyService,
    private readonly clients: ClientContextService,
  ) {}
  @Get()
  async list(@CurrentUser() actor: AuthUser, @Query() query: PenaltyPageDto) {
    const clientId = this.clients.requireClientId(actor);
    return this.service.list(
      clientId,
      await this.service.rider(clientId, actor.id),
      query.page,
      query.limit,
      query.status === 'ALL',
    );
  }
  @Get('summary')
  async summary(@CurrentUser() actor: AuthUser) {
    const clientId = this.clients.requireClientId(actor);
    return { data: await this.service.summary(clientId, await this.service.rider(clientId, actor.id)) };
  }
  @Get(':invoiceId')
  async get(
    @CurrentUser() actor: AuthUser,
    @Param('invoiceId', ParseUUIDPipe) id: string,
  ) {
    const clientId = this.clients.requireClientId(actor);
    return {
      data: await this.service.get(
        clientId,
        await this.service.rider(clientId, actor.id),
        id,
      ),
    };
  }
}
@Controller()
@ApiBearerAuth()
@ApiTags('Submission penalty status and handover clearance')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.CLIENT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class SubmissionPenaltyOperationsController {
  constructor(
    private readonly service: SubmissionPenaltyService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('client/vehicle-submissions/:id/penalties')
  async status(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.service.submissionStatus(
        this.clients.requireClientId(actor),
        actor,
        id,
      ),
    };
  }
  @Get('mobile-deployments/:id/penalty-clearance')
  async clearance(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.service.clearance(
        this.clients.requireClientId(actor),
        actor,
        id,
      ),
    };
  }
  @Post('client/mobile-deployments/:id/penalty-handover-exception')
  @Roles(UserRole.CLIENT_ADMIN)
  async approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PenaltyExceptionDto,
  ) {
    return {
      data: await this.service.approve(
        this.clients.requireClientId(actor),
        actor,
        id,
        body.reason,
      ),
    };
  }
}
