import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { CopyWorkPartnerDto, CreateWorkPartnerDto, UpdateWorkPartnerDto } from './dto/work-partner.dto.js';
import { WorkPartnersService } from './work-partners.service.js';

@Controller('client/work-partners')
@UseGuards(AccessTokenGuard, RolesGuard)
export class ClientWorkPartnersController {
  constructor(
    private readonly workPartners: WorkPartnersService,
    private readonly clients: ClientContextService,
  ) {}

  @Get('masters')
  @Roles(UserRole.CLIENT_ADMIN)
  async listMasters() {
    return { data: await this.workPartners.listActiveMasters() };
  }

  @Post('copies')
  @Roles(UserRole.CLIENT_ADMIN)
  async copyMaster(@CurrentUser() user: AuthUser, @Body() body: CopyWorkPartnerDto) {
    const clientId = this.clients.requireClientId(user);
    return { data: await this.workPartners.copyMasterToClient(clientId, body.masterId, user.id) };
  }

  @Get('active')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER)
  async active(@CurrentUser() user: AuthUser) {
    return { data: await this.workPartners.listActiveClientPartners(this.clients.requireClientId(user)) };
  }

  @Get()
  @Roles(UserRole.CLIENT_ADMIN)
  async list(@CurrentUser() user: AuthUser) {
    return { data: await this.workPartners.listClientPartners(this.clients.requireClientId(user)) };
  }

  @Post()
  @Roles(UserRole.CLIENT_ADMIN)
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateWorkPartnerDto) {
    return { data: await this.workPartners.createClientPartner(this.clients.requireClientId(user), body, user.id) };
  }

  @Patch(':id')
  @Roles(UserRole.CLIENT_ADMIN)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: UpdateWorkPartnerDto) {
    return { data: await this.workPartners.updateClientPartner(this.clients.requireClientId(user), id, body, user.id) };
  }
}
