import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PhotoEntityType, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import { UpsertPhotoRequirementDto } from './dto/upsert-photo-requirement.dto.js';
import { MediaService } from './media.service.js';

@Controller('media')
@UseGuards(AccessTokenGuard, RolesGuard)
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly tenants: TenantContextService,
  ) {}

  @Get('photo-requirements')
  @Roles(
    UserRole.TENANT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async requirements(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType: PhotoEntityType,
  ) {
    return {
      data: await this.mediaService.requirements(
        this.tenants.requireTenantId(user),
        entityType,
      ),
    };
  }

  @Get('photos')
  @Roles(
    UserRole.TENANT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async entityPhotos(
    @CurrentUser() user: AuthUser,
    @Query('entityType', new ParseEnumPipe(PhotoEntityType))
    entityType: PhotoEntityType,
    @Query('entityId', ParseUUIDPipe) entityId: string,
  ) {
    return {
      data: await this.mediaService.listEntityPhotos(
        this.tenants.requireTenantId(user),
        entityType,
        entityId,
      ),
    };
  }

  @Put('photo-requirements/:entityType/:photoType')
  @Roles(UserRole.TENANT_ADMIN)
  async upsertRequirement(
    @CurrentUser() user: AuthUser,
    @Param('entityType', new ParseEnumPipe(PhotoEntityType))
    entityType: PhotoEntityType,
    @Param('photoType') photoType: string,
    @Body() dto: UpsertPhotoRequirementDto,
  ) {
    if (!/^[A-Z0-9_-]{1,80}$/.test(photoType)) {
      throw new BadRequestException(
        'Photo type must use uppercase letters, numbers, underscores, or hyphens.',
      );
    }
    return {
      data: await this.mediaService.upsertRequirement(
        this.tenants.requireTenantId(user),
        entityType,
        photoType,
        dto,
      ),
    };
  }

  @Post('upload-intents')
  @Roles(
    UserRole.TENANT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async createUploadIntent(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadIntentDto,
  ) {
    return {
      data: await this.mediaService.createUploadIntent(
        this.tenants.requireTenantId(user),
        user.id,
        dto,
      ),
    };
  }

  @Post(':id/complete')
  @Roles(
    UserRole.TENANT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return {
      data: await this.mediaService.complete(
        this.tenants.requireTenantId(user),
        id,
      ),
    };
  }

  @Get(':id/download-url')
  @Roles(
    UserRole.TENANT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async downloadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return {
      data: await this.mediaService.downloadUrl(
        this.tenants.requireTenantId(user),
        id,
      ),
    };
  }
}
