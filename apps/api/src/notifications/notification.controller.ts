import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { NotificationService } from './notification.service.js';
import {
  MarkAllReadDto,
  NotificationAudienceDto,
  NotificationPageDto,
  RegisterPushDeviceDto,
  SendNotificationDto,
} from './notification.dto.js';

@Controller('app')
@ApiTags('App Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.RIDER,
  UserRole.FLEET_MANAGER,
  UserRole.TEAM_LEAD,
  UserRole.KYC_OPERATOR,
  UserRole.CLIENT_ADMIN,
  UserRole.FLEET_MANAGER,
)
export class AppNotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly clients: ClientContextService,
  ) {}
  @Put('push-devices')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async register(
    @CurrentUser() actor: AuthUser,
    @Body() body: RegisterPushDeviceDto,
  ) {
    return {
      data: await this.notifications.registerDevice(
        this.clients.requireClientId(actor),
        actor,
        body,
      ),
    };
  }
  @Delete('push-devices/:installationId')
  async unregister(
    @CurrentUser() actor: AuthUser,
    @Param('installationId', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.notifications.unregisterDevice(
        this.clients.requireClientId(actor),
        actor,
        id,
      ),
    };
  }
  @Get('notifications')
  async inbox(
    @CurrentUser() actor: AuthUser,
    @Query() query: NotificationPageDto,
  ) {
    return {
      data: await this.notifications.inbox(
        this.clients.requireClientId(actor),
        actor.id,
        query,
      ),
    };
  }
  @Get('notifications/unread-count')
  async unread(@CurrentUser() actor: AuthUser) {
    return {
      data: await this.notifications.unread(
        this.clients.requireClientId(actor),
        actor.id,
      ),
    };
  }
  @Patch('notifications/:id/read')
  async read(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.notifications.read(
        this.clients.requireClientId(actor),
        actor.id,
        id,
      ),
    };
  }
  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() actor: AuthUser, @Body() body: MarkAllReadDto) {
    return {
      data: await this.notifications.readAll(
        this.clients.requireClientId(actor),
        actor.id,
        body?.throughId,
      ),
    };
  }
}
@Controller('client/notifications')
@ApiTags('Client Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER)
export class ClientNotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly clients: ClientContextService,
  ) {}
  @Post('preview')
  @HttpCode(200)
  async preview(
    @CurrentUser() actor: AuthUser,
    @Body() body: NotificationAudienceDto,
  ) {
    return {
      data: await this.notifications.preview(
        this.clients.requireClientId(actor),
        actor,
        body,
      ),
    };
  }
  @Post()
  @HttpCode(202)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async send(
    @CurrentUser() actor: AuthUser,
    @Body() body: SendNotificationDto,
    @Headers('idempotency-key') key: string,
  ) {
    return {
      data: await this.notifications.send(
        this.clients.requireClientId(actor),
        actor,
        body,
        key,
      ),
    };
  }
  @Get()
  async history(
    @CurrentUser() actor: AuthUser,
    @Query() query: NotificationPageDto,
  ) {
    return {
      data: await this.notifications.history(
        this.clients.requireClientId(actor),
        actor,
        query,
      ),
    };
  }
  @Get(':id')
  async detail(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.notifications.details(
        this.clients.requireClientId(actor),
        actor,
        id,
      ),
    };
  }
}
