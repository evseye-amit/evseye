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
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { FleetInstallationService } from './installation.service.js';
@Controller('client/fleet-installations')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  'CLIENT_ADMIN',
  'OPERATIONS_MANAGER',
  'FLEET_MANAGER',
  'ADVISOR',
  'RFD_MANAGER',
  'QC_MANAGER',
)
export class FleetInstallationController {
  constructor(
    private readonly service: FleetInstallationService,
    private readonly clients: ClientContextService,
  ) {}
  @Get() async list(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return {
      data: await this.service.list(this.clients.requireClientId(u), u, q),
    };
  }
  @Get(':id/inventory') async inventory(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: Record<string, string>,
  ) {
    return {
      data: await this.service.inventory(
        this.clients.requireClientId(u),
        u,
        id,
        q,
      ),
    };
  }
  @Get(':id') async detail(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.service.detail(this.clients.requireClientId(u), u, id),
    };
  }
  @Post(':id/upload-intents') async upload(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.upload(
        this.clients.requireClientId(u),
        u,
        id,
        b,
      ),
    };
  }
  @Post(':id/photos/:photoId/complete') async complete(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.complete(
        this.clients.requireClientId(u),
        u,
        id,
        photoId,
        b,
      ),
    };
  }
  @Get(':id/photos/:photoId/download-url') async download(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return {
      data: await this.service.download(
        this.clients.requireClientId(u),
        u,
        id,
        photoId,
      ),
    };
  }
  @Post(':id/:action') async action(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.action(
        this.clients.requireClientId(u),
        u,
        id,
        action,
        b,
      ),
    };
  }
}
