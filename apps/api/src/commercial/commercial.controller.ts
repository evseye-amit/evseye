import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'; import { Roles } from '../auth/decorators/roles.decorator.js'; import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'; import { RolesGuard } from '../auth/guards/roles.guard.js'; import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CommercialMaintenanceService } from './commercial-maintenance.service.js';
import { CommercialService } from './commercial.service.js'; import { AdjustmentDto, ConsumeFeatureDto, FeatureAddOnDto, PackageChangeDto, PurchaseAddOnDto, QuoteDto, SubscriptionDto, UpdateActiveStatusDto, UpdateFeatureAddOnDto, VehicleCountDto, VehicleTierDto } from './dto/commercial.dto.js';
@Controller('platform/commercial') @UseGuards(AccessTokenGuard, RolesGuard) @Roles(UserRole.SUPER_ADMIN)
export class CommercialController { constructor(private readonly commercial: CommercialService, private readonly maintenance: CommercialMaintenanceService) {}
  @Get('packages/:packageId/vehicle-tiers') tiers(@Param('packageId') id: string) { return this.commercial.listTiers(id).then(data => ({ data })); }
  @Post('packages/:packageId/vehicle-tiers') addTier(@Param('packageId') id: string, @Body() dto: VehicleTierDto, @CurrentUser() user: AuthUser) { return this.commercial.addTier(id, dto, user.id).then(data => ({ data })); }
  @Put('vehicle-tiers/:id') updateTier(@Param('id') id: string, @Body() dto: VehicleTierDto, @CurrentUser() user: AuthUser) { return this.commercial.updateTier(id, dto, user.id).then(data => ({ data })); }
  @Delete('vehicle-tiers/:id') deactivateTier(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.commercial.deactivateTier(id, user.id).then(data => ({ data })); }
  @Post('subscriptions/quote') quote(@Body() dto: QuoteDto) { return this.commercial.calculateSubscriptionPrice(dto).then(data => ({ data })); }
  @Post('subscriptions') createSubscription(@Body() dto: SubscriptionDto, @CurrentUser() user: AuthUser) { return this.commercial.createSubscription(dto, user.id).then(data => ({ data })); }
  @Get('subscriptions') subscriptions(@Query('clientId') clientId?: string) { return this.commercial.listSubscriptions(clientId).then(data => ({ data })); }
  @Get('subscriptions/:id') subscription(@Param('id') id: string) { return this.commercial.getSubscription(id).then(data => ({ data })); }
  @Post('subscriptions/:id/change-package') changePackage(@Param('id') id: string, @Body() dto: PackageChangeDto, @CurrentUser() user: AuthUser) { return this.commercial.changePackage(id, dto, user.id).then(data => ({ data })); }
  @Patch('subscriptions/:id/vehicle-count') vehicleCount(@Param('id') id: string, @Body() dto: VehicleCountDto, @CurrentUser() user: AuthUser) { return this.commercial.updateVehicleCount(id, dto, user.id).then(data => ({ data })); }
  @Post('adjustments') adjustment(@Body() dto: AdjustmentDto, @CurrentUser() user: AuthUser) { return this.commercial.addAdjustment(dto, user.id).then(data => ({ data })); }
  @Get('adjustments') adjustments(@Query('clientId') clientId?: string) { return this.commercial.listAdjustments(clientId).then(data => ({ data })); }
  @Get('feature-addons') addOns(@Query('featureId') featureId?: string, @Query('packageId') packageId?: string) { return this.commercial.listAddOns(featureId, packageId).then(data => ({ data })); }
  @Post('feature-addons') createAddOn(@Body() dto: FeatureAddOnDto, @CurrentUser() user: AuthUser) { return this.commercial.createAddOn(dto, user.id).then(data => ({ data })); }
  @Put('feature-addons/:id') updateAddOn(@Param('id') id: string, @Body() dto: UpdateFeatureAddOnDto, @CurrentUser() user: AuthUser) { return this.commercial.updateAddOn(id, dto, user.id).then(data => ({ data })); }
  @Patch('feature-addons/:id/status') setAddOnActive(@Param('id') id: string, @Body() dto: UpdateActiveStatusDto, @CurrentUser() user: AuthUser) { return this.commercial.setAddOnActive(id, dto.isActive, user.id).then(data => ({ data })); }
  @Put('packages/:packageId/feature-addons/:addOnId') availability(@Param('packageId') packageId: string, @Param('addOnId') addOnId: string, @Body('isAvailable') isAvailable: boolean, @CurrentUser() user: AuthUser) { return this.commercial.setAddOnAvailability(packageId, addOnId, isAvailable, user.id).then(data => ({ data })); }
  @Post('clients/:clientId/addon-purchases') purchase(@Param('clientId') clientId: string, @Body() dto: PurchaseAddOnDto, @CurrentUser() user: AuthUser) { return this.commercial.purchaseAddOn(clientId, dto, user.id).then(data => ({ data })); }
  @Get('clients/:clientId/addon-purchases') purchases(@Param('clientId') clientId: string) { return this.commercial.purchaseHistory(clientId).then(data => ({ data })); }
  @Get('clients/:clientId/features/:featureCode/balance') balance(@Param('clientId') clientId: string, @Param('featureCode') featureCode: string) { return this.commercial.getAvailableFeatureBalance(clientId, featureCode).then(data => ({ data })); }
  @Get('clients/:clientId/credit-lots') creditLots(@Param('clientId') clientId: string, @Query('featureCode') featureCode?: string) { return this.commercial.creditLots(clientId, featureCode).then(data => ({ data })); }
  @Post('clients/:clientId/feature-usage/consume') consume(@Param('clientId') clientId: string, @Body() dto: ConsumeFeatureDto, @CurrentUser() user: AuthUser) { return this.commercial.consumeFeatureUsage(clientId, dto, user.id).then(data => ({ data })); }
  @Get('clients/:clientId/feature-usage') history(@Param('clientId') clientId: string, @Query('featureCode') featureCode?: string) { return this.commercial.usageHistory(clientId, featureCode).then(data => ({ data })); }
  @Get('packages/comparison') comparison(@Query('vehicleCount') vehicleCount: string, @Query('clientId') clientId?: string) { return this.commercial.comparePackages(Number(vehicleCount), clientId).then(data => ({ data })); }
  @Post('maintenance/run') runMaintenance() { return this.maintenance.run().then(data => ({ data })); }
}
