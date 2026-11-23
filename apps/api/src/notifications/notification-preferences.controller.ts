import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateIf,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { Type } from 'class-transformer';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import {
  notificationApplications,
  type NotificationApplication,
} from './notification-catalog.service.js';
class CategoryPreferenceDto {
  @IsString() @Matches(/^PG[0-9]{2}_[A-Z0-9_]{1,90}$/) categoryCode!: string;
  @IsBoolean() pushEnabled!: boolean;
}
export class UpdateNotificationPreferencesDto {
  @IsIn(notificationApplications) application!: NotificationApplication;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  marketingEnabled?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => CategoryPreferenceDto)
  categories?: CategoryPreferenceDto[];
}
export class NotificationPreferencesQuery {
  @IsIn(notificationApplications) application!: NotificationApplication;
}
@Controller('app/notification-preferences')
@ApiTags('App Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.RIDER,
  UserRole.FLEET_MANAGER,
  UserRole.TEAM_LEAD,
  UserRole.CLIENT_ADMIN,
  UserRole.KYC_OPERATOR,
  UserRole.ADVISOR,
  UserRole.QC_MANAGER,
)
export class NotificationPreferencesController {
  constructor(
    private readonly preferences: NotificationPreferencesService,
    private readonly clients: ClientContextService,
  ) {}
  @Get()
  async get(
    @CurrentUser() actor: AuthUser,
    @Query() query: NotificationPreferencesQuery,
  ) {
    return {
      data: await this.preferences.get(
        this.clients.requireClientId(actor),
        actor,
        query.application,
      ),
    };
  }
  @Put()
  async update(
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateNotificationPreferencesDto,
  ) {
    return {
      data: await this.preferences.update(
        this.clients.requireClientId(actor),
        actor,
        body,
      ),
    };
  }
}
