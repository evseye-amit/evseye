import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ImportEntityType, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  CreateFeatureDto,
  CreateTrainingContentDto,
  CreateTrainingContentUploadIntentDto,
  CreateFeatureStepDto,
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
  UpdateTrainingContentDto,
  UpdateFeatureStepDto,
  UpdateFeaturePricingDto,
  UpdateOemDto,
  UpdatePackageDto,
  UpdatePackageFeatureDto,
  UpdateVehicleCategoryDto,
  UpdateVehicleTypeDto,
} from './dto/catalog.dto.js';
import { PlatformCatalogService } from './platform-catalog.service.js';
import { CatalogRevisionService } from './catalog-revision.service.js';
import { importFailuresToCsv } from '../imports/import-failure.js';

@Controller('platform')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformCatalogController {
  constructor(private readonly catalog: PlatformCatalogService, private readonly revisions: CatalogRevisionService) {}
  @Get(':entity/imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedImportRecords(@Param('entity') entity: string, @Param('id') id: string) {
    const map: Record<string, ImportEntityType> = { oems: ImportEntityType.OEM, 'vehicle-categories': ImportEntityType.VEHICLE_CATEGORY, 'vehicle-types': ImportEntityType.VEHICLE_TYPE, features: ImportEntityType.FEATURE, packages: ImportEntityType.PACKAGE };
    const value = map[entity];
    if (!value) return '';
    const rows = await this.catalog.platformImportFailures(id, value);
    return importFailuresToCsv(rows);
  }
  @Post(':entity/imports/:id/retry')
  async retryImport(@Param('entity') entity: string, @Param('id') id: string, @Body() body: { rows: Array<Record<string, unknown>> }, @CurrentUser() user: AuthUser) {
    const map: Record<string, ImportEntityType> = { oems: ImportEntityType.OEM, 'vehicle-categories': ImportEntityType.VEHICLE_CATEGORY, 'vehicle-types': ImportEntityType.VEHICLE_TYPE, features: ImportEntityType.FEATURE, packages: ImportEntityType.PACKAGE };
    const entityType = map[entity];
    if (!entityType || !Array.isArray(body.rows)) throw new BadRequestException('Valid import entity and rows are required.');
    return { data: await this.catalog.retryPlatformImport(id, entityType, user.id, body.rows) };
  }
  @Get('features/:id/revisions') featureRevisions(@Param('id') id: string) {
    return this.revisions.featureRevisions(id).then((data) => ({ data }));
  }
  @Post('features/:id/revisions') draftFeature(@Param('id') id: string) {
    return this.revisions.draftFeature(id).then((data) => ({ data }));
  }
  @Post('feature-revisions/:id/publish') publishFeature(@Param('id') id: string) {
    return this.revisions.publishFeature(id).then((data) => ({ data }));
  }
  @Get('packages/:id/revisions') packageRevisions(@Param('id') id: string) {
    return this.revisions.packageRevisions(id).then((data) => ({ data }));
  }
  @Post('packages/:id/revisions') draftPackage(@Param('id') id: string) {
    return this.revisions.draftPackage(id).then((data) => ({ data }));
  }
  @Post('package-revisions/:id/publish') publishPackage(@Param('id') id: string) {
    return this.revisions.publishPackage(id).then((data) => ({ data }));
  }
  @Post('subscriptions/:id/package-revisions/:revisionId') assignPackageRevision(
    @Param('id') id: string, @Param('revisionId') revisionId: string,
  ) {
    return this.revisions.assignPackageRevision(id, revisionId).then((data) => ({ data }));
  }
  @Get('subscriptions/:id/package-upgrades/:revisionId/preview') previewPackageUpgrade(
    @Param('id') id: string, @Param('revisionId') revisionId: string,
  ) {
    return this.revisions.previewPackageUpgrade(id, revisionId).then((data) => ({ data }));
  }
  @Post('subscriptions/:id/package-upgrades/:revisionId') upgradePackageRevision(
    @Param('id') id: string, @Param('revisionId') revisionId: string,
    @Body() body: unknown, @CurrentUser() user: AuthUser,
  ) {
    return this.revisions.upgradePackageRevision(id, revisionId, body, user.id).then((data) => ({ data }));
  }
  @Get('subscriptions/:id/workflow-revisions') clientWorkflowRevisions(@Param('id') id: string) {
    return this.revisions.clientWorkflowRevisions(id).then((data) => ({ data }));
  }
  @Post('subscriptions/:id/workflow-revisions') draftClientWorkflow(@Param('id') id: string, @Body() body: unknown) {
    return this.revisions.draftClientWorkflow(id, body).then((data) => ({ data }));
  }
  @Post('workflow-revisions/:id/publish') publishClientWorkflow(@Param('id') id: string) {
    return this.revisions.publishClientWorkflow(id).then((data) => ({ data }));
  }
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
  @Get('feature-steps') featureSteps() {
    return this.catalog.listFeatureSteps().then((data) => ({ data }));
  }
  @Post('feature-steps') createFeatureStep(
    @Body() dto: CreateFeatureStepDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createFeatureStep(dto, user.id).then((data) => ({ data }));
  }
  @Put('feature-steps/:id') updateFeatureStep(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureStepDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateFeatureStep(id, dto, user.id).then((data) => ({ data }));
  }
  @Delete('feature-steps/:id') deleteFeatureStep(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.deleteFeatureStep(id, user.id).then(() => ({ data: { deleted: true } }));
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
  @Get('training-content') trainingContent() {
    return this.catalog.listTrainingContent().then((data) => ({ data }));
  }
  @Post('training-content/upload-intents') createTrainingContentUploadIntent(
    @Body() dto: CreateTrainingContentUploadIntentDto,
  ) {
    return this.catalog.createTrainingContentUploadIntent(dto).then((data) => ({ data }));
  }
  @Post('training-content') createTrainingContent(
    @Body() dto: CreateTrainingContentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createTrainingContent(dto, user.id).then((data) => ({ data }));
  }
  @Put('training-content/:id') updateTrainingContent(
    @Param('id') id: string,
    @Body() dto: UpdateTrainingContentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateTrainingContent(id, dto, user.id).then((data) => ({ data }));
  }
  @Delete('training-content/:id') deactivateTrainingContent(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.deactivateTrainingContent(id, user.id).then((data) => ({ data }));
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
  @Get('features/:featureId/current-price') currentPricing(
    @Param('featureId') featureId: string,
    @Query('effectiveDate') effectiveDate?: string,
  ) {
    return this.catalog
      .getCurrentPricing(featureId, effectiveDate ? new Date(effectiveDate) : undefined)
      .then((data) => ({ data }));
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
