import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientResolverService } from '../client-identity/client-resolver.service.js';
import { AppUpdateService } from './app-update.service.js';
import {
  AppCheckDto,
  PolicyRevisionDto,
  PreviewAppPolicyDto,
  PublicAppCheckDto,
  PublishAppPolicyDto,
  RestoreAppPolicyDto,
  SaveAppPolicyDto,
} from './app-update.dto.js';
import {
  evaluatePolicy,
  validateRelease,
  validateSettings,
} from './app-update-policy.js';

@ApiTags('App updates')
@Controller('public/app-updates')
export class PublicAppUpdateController {
  constructor(
    private readonly updates: AppUpdateService,
    private readonly resolver: ClientResolverService,
  ) {}
  @Post('check')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async check(@Body() body: PublicAppCheckDto, @Req() request: FastifyRequest) {
    const resolved = await this.resolver.fromRequest(request);
    const clientId = await this.updates.clientForCode(
      body.companyCode,
      resolved?.clientId,
    );
    return { data: await this.updates.check(clientId, body) };
  }
}
@ApiTags('App updates')
@Controller('app-updates')
@UseGuards(AccessTokenGuard)
export class AuthenticatedAppUpdateController {
  constructor(private readonly updates: AppUpdateService) {}
  @Post('check')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async check(@Body() body: AppCheckDto, @CurrentUser() user: AuthUser) {
    if (!user.clientId)
      throw new ForbiddenException('Client context is required.');
    return { data: await this.updates.check(user.clientId, body) };
  }
}
@ApiTags('App updates')
@Controller('platform/clients/:clientId/app-updates')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AppUpdateAdminController {
  constructor(private readonly updates: AppUpdateService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Param('clientId') clientId: string) {
    return { data: await this.updates.list(clientId) };
  }
  @Put('draft')
  async save(
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SaveAppPolicyDto,
  ) {
    return { data: await this.updates.save(clientId, user.id, body) };
  }
  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: PreviewAppPolicyDto) {
    validateSettings(body, body.settings);
    validateRelease(body.platform, body.installed);
    return {
      data: evaluatePolicy(body.settings, body.installed, body.platform),
    };
  }
  @Post(':id/publish')
  async publish(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: PublishAppPolicyDto,
  ) {
    return {
      data: await this.updates.publish(
        clientId,
        id,
        user.id,
        body.expectedRevision,
        body.releaseAvailable,
      ),
    };
  }
  @Post(':id/disable')
  async disable(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: PolicyRevisionDto,
  ) {
    return {
      data: await this.updates.disable(
        clientId,
        id,
        user.id,
        body.expectedRevision,
      ),
    };
  }
  @Post(':id/restore')
  async restore(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: RestoreAppPolicyDto,
  ) {
    return {
      data: await this.updates.restore(
        clientId,
        id,
        user.id,
        body.expectedRevision,
        body.sourceRevision,
      ),
    };
  }
}
