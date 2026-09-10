import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import { MediaService } from './media.service.js';

@Controller('media')
@UseGuards(AccessTokenGuard, RolesGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService, private readonly tenants: TenantContextService) {}

  @Post('upload-intents')
  @Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.KYC_OPERATOR)
  async createUploadIntent(@CurrentUser() user: AuthUser, @Body() dto: CreateUploadIntentDto) {
    return { data: await this.mediaService.createUploadIntent(this.tenants.requireTenantId(user), user.id, dto) };
  }

  @Post(':id/complete')
  @Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.KYC_OPERATOR)
  async complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.mediaService.complete(this.tenants.requireTenantId(user), id) };
  }

  @Get(':id/download-url')
  @Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.KYC_OPERATOR)
  async downloadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.mediaService.downloadUrl(this.tenants.requireTenantId(user), id) };
  }
}
