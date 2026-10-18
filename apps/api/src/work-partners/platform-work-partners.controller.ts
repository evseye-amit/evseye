import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CopyWorkPartnerDto, CreateWorkPartnerDto, UpdateWorkPartnerDto } from './dto/work-partner.dto.js';
import { WorkPartnersService } from './work-partners.service.js';

@Controller('platform')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformWorkPartnersController {
  constructor(private readonly workPartners: WorkPartnersService) {}

  @Get('work-partners')
  async listMasters() {
    return { data: await this.workPartners.listMasters() };
  }

  @Post('work-partners')
  async createMaster(@Body() body: CreateWorkPartnerDto, @CurrentUser() user: AuthUser) {
    return { data: await this.workPartners.createMaster(body, user.id) };
  }

  @Patch('work-partners/:id')
  async updateMaster(@Param('id') id: string, @Body() body: UpdateWorkPartnerDto, @CurrentUser() user: AuthUser) {
    return { data: await this.workPartners.updateMaster(id, body, user.id) };
  }

  @Get('clients/:clientId/work-partners')
  async listClientPartners(@Param('clientId') clientId: string) {
    return { data: await this.workPartners.listClientPartnersForPlatform(clientId) };
  }

  @Post('clients/:clientId/work-partners/copies')
  async copyToClient(
    @Param('clientId') clientId: string,
    @Body() body: CopyWorkPartnerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return { data: await this.workPartners.copyMasterToClient(clientId, body.masterId, user.id) };
  }
}
