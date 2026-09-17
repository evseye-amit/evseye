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
  BulkCreatePackagesDto,
  BulkCreateVehicleCategoriesDto,
  BulkCreateVehicleTypesDto,
  BulkCreateFeaturesDto,
  BulkCreateOemsDto,
  CompleteOemLogoUploadDto,
  CreateOemLogoUploadIntentDto,
  CreateFeaturePricingDto,
  CreateOemDto,
  CreatePackageDto,
  CreatePackageFeatureAssignmentDto,
  CreateVehicleCategoryDto,
  CreateVehicleTypeDto,
  UpdateFeatureDto,
  UpdateFeaturePricingDto,
  UpdateOemDto,
  UpdatePackageDto,
  UpdatePackageFeatureDto,
  UpdateVehicleCategoryDto,
  UpdateVehicleTypeDto,
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
  @Get('vehicle-categories') vehicleCategories() {
    return this.catalog.listVehicleCategories().then((data) => ({ data }));
  }
  @Post('vehicle-categories') createVehicleCategory(
    @Body() dto: CreateVehicleCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .createVehicleCategory(dto, user.id)
      .then((data) => ({ data }));
  }
  @Post('vehicle-categories/bulk') bulkCreateVehicleCategories(
    @Body() dto: BulkCreateVehicleCategoriesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .bulkCreateVehicleCategories(dto, user.id)
      .then((data) => ({ data }));
  }
  @Put('vehicle-categories/:id') updateVehicleCategory(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .updateVehicleCategory(id, dto, user.id)
      .then((data) => ({ data }));
  }
  @Delete('vehicle-categories/:id') deleteVehicleCategory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .deleteVehicleCategory(id, user.id)
      .then(() => ({ data: { deleted: true } }));
  }
  @Get('vehicle-types') vehicleTypes() {
    return this.catalog.listVehicleTypes().then((data) => ({ data }));
  }
  @Post('vehicle-types') createVehicleType(
    @Body() dto: CreateVehicleTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .createVehicleType(dto, user.id)
      .then((data) => ({ data }));
  }
  @Post('vehicle-types/bulk') bulkCreateVehicleTypes(
    @Body() dto: BulkCreateVehicleTypesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .bulkCreateVehicleTypes(dto, user.id)
      .then((data) => ({ data }));
  }
  @Put('vehicle-types/:id') updateVehicleType(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .updateVehicleType(id, dto, user.id)
      .then((data) => ({ data }));
  }
  @Delete('vehicle-types/:id') deleteVehicleType(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .deleteVehicleType(id, user.id)
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
  @Post('features/bulk') bulkCreateFeatures(
    @Body() dto: BulkCreateFeaturesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .bulkCreateFeatures(dto, user.id)
      .then((data) => ({ data }));
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
  @Post('packages/bulk') bulkCreatePackages(
    @Body() dto: BulkCreatePackagesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .bulkCreatePackages(dto, user.id)
      .then((data) => ({ data }));
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
  @Get('package-features') packageFeatures() {
    return this.catalog.listPackageFeatures().then((data) => ({ data }));
  }
  @Post('package-features') createPackageFeature(
    @Body() dto: CreatePackageFeatureAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .createPackageFeature(dto, user.id)
      .then((data) => ({ data }));
  }
  @Put('package-features/:id') updatePackageFeature(
    @Param('id') id: string,
    @Body() dto: UpdatePackageFeatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .updatePackageFeature(id, dto, user.id)
      .then((data) => ({ data }));
  }
  @Delete('package-features/:id') deletePackageFeature(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog
      .deletePackageFeature(id, user.id)
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
