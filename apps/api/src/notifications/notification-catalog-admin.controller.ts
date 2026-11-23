import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { NotificationCatalogAdminService } from './notification-catalog-admin.service.js';
import {
  CreateCatalogCategoryDto,
  UpdateCatalogCategoryDto,
  UpdateCatalogGroupDto,
} from './notification-catalog-admin.dto.js';
@Controller('platform/notifications/catalog')
@ApiTags('Notification catalog administration')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class NotificationCatalogAdminController {
  constructor(private readonly catalog: NotificationCatalogAdminService) {}
  @Get() async list(@CurrentUser() actor: AuthUser) {
    return { data: await this.catalog.list(actor) };
  }
  @Post('categories') async create(
    @CurrentUser() actor: AuthUser,
    @Body() input: CreateCatalogCategoryDto,
  ) {
    return { data: await this.catalog.create(actor, input) };
  }
  @Patch('categories/:code') async update(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body() input: UpdateCatalogCategoryDto,
  ) {
    return { data: await this.catalog.update(actor, code, input) };
  }
  @Patch('groups/:code') async group(
    @CurrentUser() actor: AuthUser,
    @Param('code') code: string,
    @Body() input: UpdateCatalogGroupDto,
  ) {
    return { data: await this.catalog.group(actor, code, input) };
  }
}
