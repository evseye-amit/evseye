import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  CreateFeatureDto,
  BulkCreateOemsDto,
  CompleteOemLogoUploadDto,
  CreateOemLogoUploadIntentDto,
  CreateFeaturePricingDto,
  CreateOemDto,
  CreatePackageDto,
  UpdateFeatureDto,
  UpdateFeaturePricingDto,
  UpdateOemDto,
  UpdatePackageDto,
} from './dto/catalog.dto.js';
import { PlatformCatalogService } from './platform-catalog.service.js';

@Controller('platform')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformCatalogController {
  constructor(private readonly catalog: PlatformCatalogService) {}
  @Get('dashboard') dashboard() {
    return this.catalog.dashboard().then((data) => ({ data }));
  }
  @Get('oems') oems() {
    return this.catalog.listOems().then((data) => ({ data }));
  }
  @Post('oems') createOem(
    @Body() dto: CreateOemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createOem(dto, user.id).then((data) => ({ data }));
  }
  @Post('oems/bulk') bulkCreateOems(
    @Body() dto: BulkCreateOemsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.bulkCreateOems(dto, user.id).then((data) => ({ data }));
  }
  @Post('oems/:id/logo-upload-intents') createOemLogoUploadIntent(
    @Param('id') id: string,
    @Body() dto: CreateOemLogoUploadIntentDto,
  ) {
    return this.catalog
      .createOemLogoUploadIntent(id, dto)
      .then((data) => ({ data }));
  }
  @Post('oems/:id/logo-upload-complete') completeOemLogoUpload(
    @Param('id') id: string,
    @Body() dto: CompleteOemLogoUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .completeOemLogoUpload(id, dto, user.id)
      .then((data) => ({ data }));
  }
  @Put('oems/:id') updateOem(
    @Param('id') id: string,
    @Body() dto: UpdateOemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateOem(id, dto, user.id).then((data) => ({ data }));
  }
  @Delete('oems/:id') deleteOem(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .deleteOem(id, user.id)
      .then(() => ({ data: { deleted: true } }));
  }
  @Get('features') features() {
    return this.catalog.listFeatures().then((data) => ({ data }));
  }
  @Post('features') createFeature(
    @Body() dto: CreateFeatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createFeature(dto, user.id).then((data) => ({ data }));
  }
  @Put('features/:id') updateFeature(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .updateFeature(id, dto, user.id)
      .then((data) => ({ data }));
  }
  @Delete('features/:id') deleteFeature(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .deleteFeature(id, user.id)
      .then(() => ({ data: { deleted: true } }));
  }
  @Get('packages') packages() {
    return this.catalog.listPackages().then((data) => ({ data }));
  }
  @Post('packages') createPackage(
    @Body() dto: CreatePackageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createPackage(dto, user.id).then((data) => ({ data }));
  }
  @Put('packages/:id') updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdatePackageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .updatePackage(id, dto, user.id)
      .then((data) => ({ data }));
  }
  @Delete('packages/:id') deletePackage(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .deletePackage(id, user.id)
      .then(() => ({ data: { deleted: true } }));
  }
  @Get('feature-pricing') pricing() {
    return this.catalog.listPricing().then((data) => ({ data }));
  }
  @Post('feature-pricing') createPricing(
    @Body() dto: CreateFeaturePricingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createPricing(dto, user.id).then((data) => ({ data }));
  }
  @Put('feature-pricing/:id') updatePricing(
    @Param('id') id: string,
    @Body() dto: UpdateFeaturePricingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .updatePricing(id, dto, user.id)
      .then((data) => ({ data }));
  }
  @Delete('feature-pricing/:id') deletePricing(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .deletePricing(id, user.id)
      .then(() => ({ data: { deleted: true } }));
  }
}
