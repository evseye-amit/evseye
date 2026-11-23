import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { NotificationTopicService } from './notification-topic.service.js';
export class SubscriptionQuery {
  @IsIn(['RIDER_APP', 'FLEET_MANAGER_APP', 'TEAM_LEADER_APP']) appCode!: string;
}
export class TopicListQuery {
  @IsOptional() @IsUUID() after?: string;
}
export class TopicActiveDto {
  @IsBoolean() isActive!: boolean;
}
@Controller('app/notification-subscriptions')
@ApiTags('App Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class NotificationSubscriptionController {
  constructor(
    private readonly topics: NotificationTopicService,
    private readonly clients: ClientContextService,
  ) {}
  @Get(':installationId')
  async get(
    @CurrentUser() actor: AuthUser,
    @Param('installationId', ParseUUIDPipe) id: string,
    @Query() query: SubscriptionQuery,
  ) {
    return {
      data: await this.topics.status(
        this.clients.requireClientId(actor),
        actor,
        id,
        query.appCode,
      ),
    };
  }
  @Post(':installationId/sync')
  async sync(
    @CurrentUser() actor: AuthUser,
    @Param('installationId', ParseUUIDPipe) id: string,
    @Body() body: SubscriptionQuery,
  ) {
    return {
      data: await this.topics.status(
        this.clients.requireClientId(actor),
        actor,
        id,
        body.appCode,
        true,
      ),
    };
  }
}
@Controller('client/notification-topics')
@ApiTags('Client Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class NotificationTopicController {
  constructor(
    private readonly topics: NotificationTopicService,
    private readonly clients: ClientContextService,
  ) {}
  @Get()
  async list(@CurrentUser() actor: AuthUser, @Query() query: TopicListQuery) {
    return {
      data: await this.topics.list(
        this.clients.requireClientId(actor),
        query.after,
      ),
    };
  }
  @Patch(':id')
  async active(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TopicActiveDto,
  ) {
    return {
      data: await this.topics.setActive(
        this.clients.requireClientId(actor),
        actor,
        id,
        body.isActive,
      ),
    };
  }
}
