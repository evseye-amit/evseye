import { Body, Controller, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { NotificationConfigurationService } from './notification-configuration.service.js';
export class ConfigurePushBindingDto {
  @IsUUID() clientId!: string;
  @IsIn(['RIDER_APP', 'FLEET_MANAGER_APP', 'TEAM_LEADER_APP']) appCode!: string;
  @IsIn(['ANDROID', 'IOS']) platform!: string;
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(255)
  applicationId!: string;
  @IsString() @Matches(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/) projectId!: string;
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,149}$/) credentialReference!: string;
}
@Controller('platform/notifications/firebase-bindings')
@ApiTags('Notification configuration')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class NotificationConfigurationController {
  constructor(
    private readonly configuration: NotificationConfigurationService,
  ) {}
  @Put()
  async configure(
    @CurrentUser() actor: AuthUser,
    @Body() input: ConfigurePushBindingDto,
  ) {
    return { data: await this.configuration.configure(actor, input) };
  }
}
