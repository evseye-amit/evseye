import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CommercialOfferService } from '../rider-rate-cards/commercial-offer.service.js';
import { VehicleExchangeService } from './vehicle-exchange.service.js';

@Controller('vehicle-exchanges')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class VehicleExchangeController {
  constructor(
    private readonly exchanges: VehicleExchangeService,
    private readonly context: ClientContextService,
  ) {}
  @Get('policy') policy(@CurrentUser() user: AuthUser) {
    return this.exchanges.policy(this.context.requireClientId(user));
  }
  @Post('policy') @Roles(UserRole.CLIENT_ADMIN) setPolicy(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.exchanges.setPolicy(
      this.context.requireClientId(user),
      user.id,
      body,
    );
  }
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.exchanges.list(this.context.requireClientId(user));
  }
  @Get('agreements/:agreementId/versions') history(
    @CurrentUser() user: AuthUser,
    @Param('agreementId') agreementId: string,
  ) {
    return this.exchanges.history(
      this.context.requireClientId(user),
      agreementId,
    );
  }
  @Post() request(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.exchanges.request(
      this.context.requireClientId(user),
      user.id,
      body,
    );
  }
  @Get(':id') details(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exchanges.details(this.context.requireClientId(user), id);
  }
  @Post(':id/approve') approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.approve(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post(':id/reject') rejectRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.exchanges.reject(
      this.context.requireClientId(user),
      id,
      user.id,
      body,
    );
  }
  @Post(':id/replacement') select(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.exchanges.select(
      this.context.requireClientId(user),
      id,
      user.id,
      body,
    );
  }
  @Get(':id/preview') preview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.preview(this.context.requireClientId(user), id);
  }
  @Post(':id/offer') present(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.present(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post(':id/accept') accept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.exchanges.accept(
      this.context.requireClientId(user),
      id,
      user.id,
      body,
      undefined,
      true,
    );
  }
  @Post(':id/reject-offer') reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.exchanges.rejectOffer(
      this.context.requireClientId(user),
      id,
      user.id,
      body,
    );
  }
  @Post(':id/return') startReturn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.startReturn(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post(':id/confirm-return') confirmReturn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.confirmReturn(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post(':id/reconcile-deposits') reconcile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.reconcileDeposits(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post(':id/handover') handover(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.startHandover(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post(':id/complete') complete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.complete(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
  @Post(':id/cancel') cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.exchanges.cancel(
      this.context.requireClientId(user),
      id,
      user.id,
    );
  }
}

@Controller('rider-app/vehicle-exchanges')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderVehicleExchangeController {
  constructor(
    private readonly exchanges: VehicleExchangeService,
    private readonly pricing: CommercialOfferService,
    private readonly context: ClientContextService,
  ) {}
  private async scope(user: AuthUser) {
    const clientId = this.context.requireClientId(user);
    return {
      clientId,
      riderId: await this.pricing.riderIdForUser(clientId, user.id),
    };
  }
  @Get() async list(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.scope(user);
    return this.exchanges.list(clientId, riderId);
  }
  @Get('agreements/:agreementId/versions') async history(
    @CurrentUser() user: AuthUser,
    @Param('agreementId') agreementId: string,
  ) {
    const { clientId, riderId } = await this.scope(user);
    return this.exchanges.history(clientId, agreementId, riderId);
  }
  @Post() async request(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { clientId, riderId } = await this.scope(user);
    return this.exchanges.request(clientId, user.id, body, riderId);
  }
  @Get(':id') async details(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const { clientId, riderId } = await this.scope(user);
    return this.exchanges.details(clientId, id, riderId);
  }
  @Post(':id/accept') async accept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { clientId, riderId } = await this.scope(user);
    return this.exchanges.accept(clientId, id, user.id, body, riderId);
  }
  @Post(':id/reject-offer') async reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { clientId, riderId } = await this.scope(user);
    return this.exchanges.rejectOffer(clientId, id, user.id, body, riderId);
  }
  @Post(':id/cancel') async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const { clientId, riderId } = await this.scope(user);
    await this.exchanges.details(clientId, id, riderId);
    return this.exchanges.cancel(clientId, id, user.id);
  }
}
