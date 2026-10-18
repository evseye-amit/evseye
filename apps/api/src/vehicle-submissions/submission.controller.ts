import {
  FleetManagerActionGuard,
  FleetActionResource,
} from '../auth/guards/fleet-manager-action.guard.js';
import { MediaService } from '../media/media.service.js';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VehicleSubmissionService } from './submission.service.js';
import { selectSubmissionHub } from './submission-hub.js';
import {
  CancelSubmissionReportDto,
  ConfirmSubmissionReportDto,
  MechanicReportDto,
  RequestSubmissionOtpDto,
  StartSubmissionDto,
  VerifySubmissionOtpDto,
} from './submission.dto.js';

const staff = [
  UserRole.CLIENT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
];
class SubmissionOptionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
class SubmissionQueueDto {
  @IsOptional() @IsIn(['RETURN', 'EXCHANGE']) source: 'RETURN' | 'EXCHANGE' =
    'RETURN';
  @IsOptional() @IsIn(['SCHEDULED', 'CHECKS', 'ALL']) phase:
    'SCHEDULED' | 'CHECKS' | 'ALL' = 'SCHEDULED';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
@Controller()
@ApiTags('Vehicle submission · Return and Exchange')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard, FleetManagerActionGuard)
@FleetActionResource('report')
@Roles(...staff)
export class VehicleSubmissionController {
  constructor(
    private readonly service: VehicleSubmissionService,
    private readonly clients: ClientContextService,
    private readonly db: PrismaService,
    private readonly media: MediaService,
  ) {}

  @Get('rider-app/vehicle-submissions/options')
  @Roles(UserRole.RIDER)
  async options(
    @CurrentUser() actor: AuthUser,
    @Query() query: SubmissionOptionsDto,
  ) {
    const clientId = this.clients.requireClientId(actor);
    const allocation = await this.db.allocation.findFirst({
      where: {
        clientId,
        status: 'ACTIVE',
        rider: { userId: actor.id, clientId, deletedAt: null },
      },
      orderBy: { allocatedAt: 'desc' },
    });
    if (!allocation)
      return { data: { defaultHub: null, hubs: [], activeAllocation: null } };
    const result = await selectSubmissionHub(
      this.db,
      clientId,
      allocation.fleetId,
      undefined,
      query,
    );
    return {
      data: {
        defaultHub: result.hub,
        selection: result.selection,
        hubs: result.hubs,
        activeAllocation: { id: allocation.id, fleetId: allocation.fleetId },
        requiredFields: ['plannedReturnDate'],
        optionalFields: [
          'plannedHubId',
          'reasonCode',
          'notes',
          'latitude',
          'longitude',
        ],
      },
    };
  }
  @Post('client/ride-returns/:id/submission/start')
  @FleetActionResource('return')
  async startReturn(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: StartSubmissionDto,
  ) {
    return {
      data: await this.service.start(
        this.clients.requireClientId(actor),
        actor,
        'RETURN',
        id,
        body?.hubId,
      ),
    };
  }
  @Post('vehicle-exchanges/:id/submission/start')
  @FleetActionResource('exchange')
  async startExchange(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: StartSubmissionDto,
  ) {
    return {
      data: await this.service.start(
        this.clients.requireClientId(actor),
        actor,
        'EXCHANGE',
        id,
        body?.hubId,
      ),
    };
  }
  @Get('client/vehicle-submissions/requests')
  async queue(
    @CurrentUser() actor: AuthUser,
    @Query() query: SubmissionQueueDto,
  ) {
    return this.service.queue(
      this.clients.requireClientId(actor),
      actor,
      query.source,
      query.phase,
      query.page,
      query.limit,
    );
  }
  @Get('client/vehicle-submissions/:id')
  async get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return {
      data: await this.service.get(
        this.clients.requireClientId(actor),
        actor,
        id,
      ),
    };
  }
  @Get('rider-app/vehicle-submissions/:id')
  @Roles(UserRole.RIDER)
  async riderGet(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return {
      data: await this.service.get(
        this.clients.requireClientId(actor),
        actor,
        id,
      ),
    };
  }
  @Get('client/vehicle-submissions/:id/photos/:photoId/url')
  async photo(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    const clientId = this.clients.requireClientId(actor);
    await this.service.authorizePhoto(clientId, actor, id, photoId);
    return { data: await this.media.downloadUrl(clientId, photoId) };
  }
  @Get('rider-app/vehicle-submissions/:id/photos/:photoId/url')
  @Roles(UserRole.RIDER)
  async riderPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photo(actor, id, photoId);
  }
  @Post('client/vehicle-submissions/:id/reports')
  @FleetActionResource('submission')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async report(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: MechanicReportDto,
    @Headers('idempotency-key') key: string,
  ) {
    return {
      data: await this.service.recordReport(
        this.clients.requireClientId(actor),
        actor,
        id,
        body,
        key,
      ),
    };
  }
  @Patch('client/vehicle-submission-reports/:id')
  async updateReport(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: MechanicReportDto,
    @Headers('if-match') digest: string,
  ) {
    return {
      data: await this.service.updateReport(
        this.clients.requireClientId(actor),
        actor,
        id,
        body,
        digest,
      ),
    };
  }
  @Post('client/vehicle-submission-reports/:id/impose')
  async impose(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return {
      data: await this.service.impose(
        this.clients.requireClientId(actor),
        actor,
        id,
      ),
    };
  }
  @Post('client/vehicle-submission-reports/:id/otp/request')
  async requestOtp(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: RequestSubmissionOtpDto,
  ) {
    return {
      data: await this.service.requestOtps(
        this.clients.requireClientId(actor),
        actor,
        id,
        body?.party ?? 'BOTH',
      ),
    };
  }
  @Post('client/vehicle-submission-reports/:id/otp/verify')
  async verifyOtp(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: VerifySubmissionOtpDto,
  ) {
    return {
      data: await this.service.verifyOtp(
        this.clients.requireClientId(actor),
        actor,
        id,
        body.party,
        body.otpRequestId,
        body.code,
      ),
    };
  }
  @Post('client/vehicle-submission-reports/:id/confirm')
  async confirm(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: ConfirmSubmissionReportDto,
  ) {
    return {
      data: await this.service.confirm(
        this.clients.requireClientId(actor),
        actor,
        id,
        body ?? {},
      ),
    };
  }
  @Post('client/vehicle-submission-reports/:id/cancel')
  async cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: CancelSubmissionReportDto,
  ) {
    return {
      data: await this.service.cancelReport(
        this.clients.requireClientId(actor),
        actor,
        id,
        body.reason,
      ),
    };
  }
}
