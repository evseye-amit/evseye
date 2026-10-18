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
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { SparesService } from './spares.service.js';
@Controller('platform/spares')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class SpareMasterController {
  constructor(private readonly service: SparesService) {}
  @Get() async list(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return { data: await this.service.masters(u, q) };
  }
  @Post() async create(@CurrentUser() u: AuthUser, @Body() b: unknown) {
    return { data: await this.service.createMaster(u, b) };
  }
  @Patch(':id') async update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return { data: await this.service.updateMaster(u, id, b) };
  }
  @Get(':id/history') async history(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.service.history(u, id) };
  }
}
@Controller('client/spares')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('CLIENT_ADMIN')
export class ClientSpareController {
  constructor(
    private readonly service: SparesService,
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
  @Post() async create(@CurrentUser() u: AuthUser, @Body() b: unknown) {
    return {
      data: await this.service.createClientSpare(
        this.clients.requireClientId(u),
        u,
        b,
      ),
    };
  }
  @Post('import-missing') async import(@CurrentUser() u: AuthUser) {
    return {
      data: await this.service.importMissing(
        this.clients.requireClientId(u),
        u,
      ),
    };
  }
  @Get('master-updates') async preview(@CurrentUser() u: AuthUser) {
    return {
      data: await this.service.preview(this.clients.requireClientId(u), u),
    };
  }
  @Post('master-updates/apply') async apply(
    @CurrentUser() u: AuthUser,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.apply(this.clients.requireClientId(u), u, b),
    };
  }
  @Patch(':id') async update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.updateClient(
        this.clients.requireClientId(u),
        u,
        id,
        b,
      ),
    };
  }
  @Get(':id/history') async history(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.service.history(u, id, this.clients.requireClientId(u)),
    };
  }
}
