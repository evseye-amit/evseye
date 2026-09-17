import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ClientResolverService } from './client-resolver.service.js';
import { ClientBrandingService } from './client-branding.service.js';
import {
  BrandingUploadDto,
  CompleteBrandingUploadDto,
  UpdateBrandingDto,
} from './branding.dto.js';
@Controller('public')
export class PublicClientController {
  constructor(
    private readonly resolver: ClientResolverService,
    private readonly branding: ClientBrandingService,
  ) {}
  @Get('client-context')
  @Header('Cache-Control', 'no-store')
  async context(@Req() request: FastifyRequest) {
    return {
      data: await this.branding.context(
        (await this.resolver.fromRequest(request))?.clientId,
      ),
    };
  }
}
@Controller('client/identity')
@UseGuards(AccessTokenGuard, RolesGuard)
export class ClientBrandingController {
  constructor(
    private readonly branding: ClientBrandingService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('context')
  @Header('Cache-Control', 'no-store')
  async context(@CurrentUser() user: AuthUser) {
    return {
      data: await this.branding.context(this.clients.requireClientId(user)),
    };
  }
  @Patch('branding')
  @Roles('CLIENT_ADMIN')
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return {
      data: await this.branding.update(
        this.clients.requireClientId(user),
        dto,
        user.id,
      ),
    };
  }
  @Post('branding/upload-intents')
  @Roles('CLIENT_ADMIN')
  async upload(@CurrentUser() user: AuthUser, @Body() dto: BrandingUploadDto) {
    return {
      data: await this.branding.upload(this.clients.requireClientId(user), dto),
    };
  }
  @Post('branding/upload-complete')
  @Roles('CLIENT_ADMIN')
  async complete(
    @CurrentUser() user: AuthUser,
    @Body() dto: CompleteBrandingUploadDto,
  ) {
    return {
      data: await this.branding.complete(
        this.clients.requireClientId(user),
        dto,
        user.id,
      ),
    };
  }
}
