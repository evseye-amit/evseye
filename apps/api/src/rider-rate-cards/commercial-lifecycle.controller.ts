import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
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
import { CommercialLifecycleService } from './commercial-lifecycle.service.js';

@Controller('rider-commercial-terms')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class RiderCommercialTermsController {
  constructor(
    private readonly lifecycle: CommercialLifecycleService,
    private readonly context: ClientContextService,
  ) {}
  @Get() list(@CurrentUser() user: AuthUser) {
    return {
      data: this.lifecycle.listTerms(this.context.requireClientId(user)),
    };
  }
  @Post() async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return {
      data: await this.lifecycle.createTerms(
        this.context.requireClientId(user),
        user.id,
        body,
      ),
    };
  }
  @Post(':id/activate') async activate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.lifecycle.activateTerms(
        this.context.requireClientId(user),
        user.id,
        id,
      ),
    };
  }
}

@Controller('rider-commercial-offers')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderCommercialOffersController {
  constructor(
    private readonly lifecycle: CommercialLifecycleService,
    private readonly context: ClientContextService,
  ) {}
  @Post() async create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return {
      data: await this.lifecycle.createOffer(
        this.context.requireClientId(user),
        user.id,
        body,
        key,
      ),
    };
  }
  @Get() async list(@CurrentUser() user: AuthUser) {
    return {
      data: await this.lifecycle.listOffers(this.context.requireClientId(user)),
    };
  }
  @Get(':id') async get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.lifecycle.getOffer(
        this.context.requireClientId(user),
        id,
      ),
    };
  }
  @Post(':id/present') async present(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.lifecycle.transitionOffer(
        this.context.requireClientId(user),
        user.id,
        id,
        'PRESENT',
      ),
    };
  }
  @Post(':id/cancel') async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.transitionOffer(
        this.context.requireClientId(user),
        user.id,
        id,
        'CANCEL',
        body,
      ),
    };
  }
  @Post(':id/assist-accept') @Roles(UserRole.CLIENT_ADMIN) async assistAccept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.acceptOffer(
        this.context.requireClientId(user),
        user.id,
        id,
        body,
        undefined,
        true,
      ),
    };
  }
}

@Controller('rider-app/commercial-offers')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderCommercialOffersAppController {
  constructor(
    private readonly lifecycle: CommercialLifecycleService,
    private readonly pricing: CommercialOfferService,
    private readonly context: ClientContextService,
  ) {}
  private async identity(user: AuthUser) {
    const clientId = this.context.requireClientId(user);
    return {
      clientId,
      riderId: await this.pricing.riderIdForUser(clientId, user.id),
    };
  }
  @Post() async create(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
  ) {
    const { clientId, riderId } = await this.identity(user);
    const offer = await this.lifecycle.createOffer(
      clientId,
      user.id,
      { ...body, riderId },
      key,
      true,
    );
    return { data: this.lifecycle.offerView(offer) };
  }
  @Get() async list(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.identity(user);
    const offers = await this.lifecycle.listOffers(clientId, riderId);
    return { data: offers.map((offer) => this.lifecycle.offerView(offer)) };
  }
  @Get(':id') async get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const { clientId, riderId } = await this.identity(user);
    return {
      data: this.lifecycle.offerView(
        await this.lifecycle.getOffer(clientId, id, riderId),
      ),
    };
  }
  @Post(':id/accept') async accept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { clientId, riderId } = await this.identity(user);
    const agreement = await this.lifecycle.acceptOffer(
      clientId,
      user.id,
      id,
      body,
      riderId,
    );
    return { data: this.lifecycle.agreementView(agreement) };
  }
  @Post(':id/reject') async reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { clientId, riderId } = await this.identity(user);
    const offer = await this.lifecycle.transitionOffer(
      clientId,
      user.id,
      id,
      'REJECT',
      body,
      riderId,
    );
    return { data: this.lifecycle.offerView(offer) };
  }
}

@Controller('rider-rental-agreements')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderRentalAgreementsController {
  constructor(
    private readonly lifecycle: CommercialLifecycleService,
    private readonly context: ClientContextService,
  ) {}
  @Get() async list(@CurrentUser() user: AuthUser) {
    return {
      data: await this.lifecycle.listAgreements(
        this.context.requireClientId(user),
      ),
    };
  }
  @Get(':id') async get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.lifecycle.getAgreement(
        this.context.requireClientId(user),
        id,
      ),
    };
  }
  @Post(':id/activate') async activate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.changeAgreementStatus(
        this.context.requireClientId(user),
        user.id,
        id,
        'ACTIVE',
        body,
      ),
    };
  }
  @Post(':id/suspend') async suspend(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.changeAgreementStatus(
        this.context.requireClientId(user),
        user.id,
        id,
        'SUSPENDED',
        body,
      ),
    };
  }
  @Post(':id/termination-request') async terminationRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.changeAgreementStatus(
        this.context.requireClientId(user),
        user.id,
        id,
        'TERMINATION_PENDING',
        body,
      ),
    };
  }
  @Post(':id/terminate') async terminate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.changeAgreementStatus(
        this.context.requireClientId(user),
        user.id,
        id,
        'TERMINATED',
        body,
      ),
    };
  }
  @Post(':id/complete') async complete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.changeAgreementStatus(
        this.context.requireClientId(user),
        user.id,
        id,
        'COMPLETED',
        body,
      ),
    };
  }
  @Post(':id/cancel') async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.lifecycle.changeAgreementStatus(
        this.context.requireClientId(user),
        user.id,
        id,
        'CANCELLED',
        body,
      ),
    };
  }
}

@Controller('rider-app/rental-agreements')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderRentalAgreementsAppController {
  constructor(
    private readonly lifecycle: CommercialLifecycleService,
    private readonly pricing: CommercialOfferService,
    private readonly context: ClientContextService,
  ) {}
  private async identity(user: AuthUser) {
    const clientId = this.context.requireClientId(user);
    return {
      clientId,
      riderId: await this.pricing.riderIdForUser(clientId, user.id),
    };
  }
  @Get() async list(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.identity(user);
    const agreements = await this.lifecycle.listAgreements(clientId, riderId);
    return {
      data: agreements.map((agreement) =>
        this.lifecycle.agreementView(agreement),
      ),
    };
  }
  @Get(':id') async get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const { clientId, riderId } = await this.identity(user);
    return {
      data: this.lifecycle.agreementView(
        await this.lifecycle.getAgreement(clientId, id, riderId),
      ),
    };
  }
}
