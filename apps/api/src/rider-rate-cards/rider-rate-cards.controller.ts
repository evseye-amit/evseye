import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CommercialOfferService } from './commercial-offer.service.js';
import { RiderRateCardsService } from './rider-rate-cards.service.js';

@Controller('rider-rate-cards')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderRateCardsController {
  @Post('preview') preview(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.offers.calculate(this.context.requireClientId(user), body);
  }
  constructor(
    private readonly service: RiderRateCardsService,
    private readonly context: ClientContextService,
    private readonly offers: CommercialOfferService,
  ) {}
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.service.list(this.context.requireClientId(user));
  }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(this.context.requireClientId(user), id);
  }
  @Post() @Roles(UserRole.CLIENT_ADMIN) create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.service.create(
      this.context.requireClientId(user),
      user.id,
      body,
    );
  }
  @Patch(':id') @Roles(UserRole.CLIENT_ADMIN) update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(
      this.context.requireClientId(user),
      user.id,
      id,
      body,
    );
  }
  @Post(':id/deactivate') @Roles(UserRole.CLIENT_ADMIN) deactivateCard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.deactivateCard(
      this.context.requireClientId(user),
      user.id,
      id,
    );
  }
  @Post(':id/versions') @Roles(UserRole.CLIENT_ADMIN) version(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.createVersion(
      this.context.requireClientId(user),
      user.id,
      id,
      body,
    );
  }
  @Post('versions/:id/activate') @Roles(UserRole.CLIENT_ADMIN) activate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.activateVersion(
      this.context.requireClientId(user),
      user.id,
      id,
    );
  }
  @Post('versions/:id/rental-rates') @Roles(UserRole.CLIENT_ADMIN) rental(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.addChild(
      this.context.requireClientId(user),
      user.id,
      id,
      'rentalRates',
      body,
    );
  }
  @Post('versions/:id/fees') @Roles(UserRole.CLIENT_ADMIN) fee(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.addChild(
      this.context.requireClientId(user),
      user.id,
      id,
      'fees',
      body,
    );
  }
  @Post('versions/:id/deposits') @Roles(UserRole.CLIENT_ADMIN) deposit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.addChild(
      this.context.requireClientId(user),
      user.id,
      id,
      'deposits',
      body,
    );
  }
  @Post('versions/:id/adjustments') @Roles(UserRole.CLIENT_ADMIN) adjustment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.addChild(
      this.context.requireClientId(user),
      user.id,
      id,
      'adjustments',
      body,
    );
  }
  @Patch('versions/:versionId/rental-rates/:id')
  @Roles(UserRole.CLIENT_ADMIN)
  updateRental(
    @CurrentUser() user: AuthUser,
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateChild(
      this.context.requireClientId(user),
      user.id,
      versionId,
      'rentalRates',
      id,
      body,
    );
  }
  @Patch('versions/:versionId/fees/:id')
  @Roles(UserRole.CLIENT_ADMIN)
  updateFee(
    @CurrentUser() user: AuthUser,
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateChild(
      this.context.requireClientId(user),
      user.id,
      versionId,
      'fees',
      id,
      body,
    );
  }
  @Patch('versions/:versionId/deposits/:id')
  @Roles(UserRole.CLIENT_ADMIN)
  updateDeposit(
    @CurrentUser() user: AuthUser,
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateChild(
      this.context.requireClientId(user),
      user.id,
      versionId,
      'deposits',
      id,
      body,
    );
  }
  @Patch('versions/:versionId/adjustments/:id')
  @Roles(UserRole.CLIENT_ADMIN)
  updateAdjustment(
    @CurrentUser() user: AuthUser,
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateChild(
      this.context.requireClientId(user),
      user.id,
      versionId,
      'adjustments',
      id,
      body,
    );
  }
  @Post('versions/:id/deactivate') @Roles(UserRole.CLIENT_ADMIN) deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.deactivateVersion(
      this.context.requireClientId(user),
      user.id,
      id,
    );
  }
  @Get('battery-plans/list') batteryPlans(@CurrentUser() user: AuthUser) {
    return this.service.listBatteryPlans(this.context.requireClientId(user));
  }
  @Post('battery-plans') @Roles(UserRole.CLIENT_ADMIN) batteryPlan(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.service.createBatteryPlan(
      this.context.requireClientId(user),
      user.id,
      body,
    );
  }
  @Patch('battery-plans/:id') @Roles(UserRole.CLIENT_ADMIN) updateBatteryPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateBatteryPlan(
      this.context.requireClientId(user),
      user.id,
      id,
      body,
    );
  }
  @Post('battery-plans/:id/deactivate')
  @Roles(UserRole.CLIENT_ADMIN)
  deactivateBatteryPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.deactivateBatteryPlan(
      this.context.requireClientId(user),
      user.id,
      id,
    );
  }
  @Get('promotions/list') promotions(@CurrentUser() user: AuthUser) {
    return this.service.listPromotions(this.context.requireClientId(user));
  }
  @Post('promotions') @Roles(UserRole.CLIENT_ADMIN) createPromotion(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.service.createPromotion(
      this.context.requireClientId(user),
      user.id,
      body,
    );
  }
  @Post('promotions/:id/deactivate')
  @Roles(UserRole.CLIENT_ADMIN)
  deactivatePromotion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivatePromotion(
      this.context.requireClientId(user),
      user.id,
      id,
    );
  }
  @Get('grades/:fleetId') grades(
    @CurrentUser() user: AuthUser,
    @Param('fleetId') fleetId: string,
  ) {
    return this.service.listGrades(this.context.requireClientId(user), fleetId);
  }
  @Post('grades') @Roles(UserRole.CLIENT_ADMIN) grade(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.service.assignGrade(
      this.context.requireClientId(user),
      user.id,
      body,
    );
  }
}

@Controller('rider-app/commercial-offer')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderCommercialOfferController {
  constructor(
    private readonly offers: CommercialOfferService,
    private readonly context: ClientContextService,
  ) {}
  @Post('preview')
  async preview(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
  ) {
    const clientId = this.context.requireClientId(user);
    const riderId = await this.offers.riderIdForUser(clientId, user.id);
    const result = await this.offers.calculate(
      clientId,
      { ...body, riderId },
      true,
    );
    return this.offers.riderView(result);
  }
}
