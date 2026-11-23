import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationInstallationService } from './notification-installation.service.js';
import {
  ClaimInstallationDto,
  EnrollInstallationDto,
  UpdateInstallationDto,
} from './notification-installation.dto.js';
// These routes accept installation credentials, never access-token identity or arbitrary user IDs.
@Controller('app/notification-installations')
@ApiTags('Notification Installations')
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class NotificationInstallationController {
  constructor(
    private readonly installations: NotificationInstallationService,
  ) {}
  private credential(header?: string) {
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }
  @Post()
  async enroll(@Body() body: EnrollInstallationDto) {
    return { data: await this.installations.enroll(body) };
  }
  @Post(':id/claim')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  async claim(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ClaimInstallationDto,
  ) {
    return {
      data: await this.installations.claim(
        id,
        body.installationCredential,
        actor,
        body.permission,
      ),
    };
  }
  @Get(':id')
  @ApiBearerAuth()
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') auth?: string,
  ) {
    return { data: await this.installations.access(id, this.credential(auth)) };
  }
  @Patch(':id')
  @ApiBearerAuth()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInstallationDto,
    @Headers('authorization') auth?: string,
  ) {
    return {
      data: await this.installations.access(id, this.credential(auth), body),
    };
  }
  @Delete(':id')
  @ApiBearerAuth()
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') auth?: string,
  ) {
    return {
      data: await this.installations.access(
        id,
        this.credential(auth),
        undefined,
        true,
      ),
    };
  }
}
