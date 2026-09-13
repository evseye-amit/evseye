import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  CreateClientFeatureDto,
  UpdateClientFeatureDto,
} from './dto/client-feature.dto.js';
import {
  CreateClientFeaturePricingDto,
  UpdateClientFeaturePricingDto,
} from './dto/client-feature-pricing.dto.js';
import { CreateFeatureUsageDto } from './dto/feature-usage.dto.js';
import { CreateClientOnboardingDto } from './dto/create-client-onboarding.dto.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { PlatformAdminService } from './platform-admin.service.js';

@Controller('platform')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}
  @Get('clients') listClients() {
    return this.platform.listTenants().then((data) => ({ data }));
  }
  @Post('clients') createClient(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform.createTenant(dto, user.id).then((data) => ({ data }));
  }
  @Post('clients/onboarding') onboardClient(
    @Body() dto: CreateClientOnboardingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform.onboardClient(dto, user.id).then((data) => ({ data }));
  }
  @Get('clients/:clientId/features') clientFeatures(
    @Param('clientId') clientId: string,
  ) {
    return this.platform.listClientFeatures(clientId).then((data) => ({ data }));
  }
  @Post('clients/:clientId/features') addClientFeature(
    @Param('clientId') clientId: string,
    @Body() dto: CreateClientFeatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .createClientFeature(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Patch('clients/:clientId/features/:clientFeatureId') updateClientFeature(
    @Param('clientId') clientId: string,
    @Param('clientFeatureId') clientFeatureId: string,
    @Body() dto: UpdateClientFeatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .updateClientFeature(clientId, clientFeatureId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Delete('clients/:clientId/features/:clientFeatureId') deleteClientFeature(
    @Param('clientId') clientId: string,
    @Param('clientFeatureId') clientFeatureId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .deleteClientFeature(clientId, clientFeatureId, user.id)
      .then(() => ({ data: { deleted: true } }));
  }
  @Get('clients/:clientId/features/:clientFeatureId/pricing') clientFeaturePricing(
    @Param('clientId') clientId: string,
    @Param('clientFeatureId') clientFeatureId: string,
  ) {
    return this.platform
      .listClientFeaturePricing(clientId, clientFeatureId)
      .then((data) => ({ data }));
  }
  @Post('clients/:clientId/features/:clientFeatureId/pricing') addClientFeaturePricing(
    @Param('clientId') clientId: string,
    @Param('clientFeatureId') clientFeatureId: string,
    @Body() dto: CreateClientFeaturePricingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .createClientFeaturePricing(clientId, clientFeatureId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Patch('clients/:clientId/features/:clientFeatureId/pricing/:clientFeaturePricingId') updateClientFeaturePricing(
    @Param('clientId') clientId: string,
    @Param('clientFeatureId') clientFeatureId: string,
    @Param('clientFeaturePricingId') clientFeaturePricingId: string,
    @Body() dto: UpdateClientFeaturePricingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .updateClientFeaturePricing(
        clientId,
        clientFeatureId,
        clientFeaturePricingId,
        dto,
        user.id,
      )
      .then((data) => ({ data }));
  }
  @Delete('clients/:clientId/features/:clientFeatureId/pricing/:clientFeaturePricingId') deleteClientFeaturePricing(
    @Param('clientId') clientId: string,
    @Param('clientFeatureId') clientFeatureId: string,
    @Param('clientFeaturePricingId') clientFeaturePricingId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .deleteClientFeaturePricing(
        clientId,
        clientFeatureId,
        clientFeaturePricingId,
        user.id,
      )
      .then(() => ({ data: { deleted: true } }));
  }
  @Post('clients/:clientId/usage') recordFeatureUsage(
    @Param('clientId') clientId: string,
    @Body() dto: CreateFeatureUsageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .recordFeatureUsage(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Get('clients/:clientId/subscriptions/:subscriptionId/billing-preview') billingPreview(
    @Param('clientId') clientId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.platform
      .billingPreview(clientId, subscriptionId, from, to)
      .then((data) => ({ data }));
  }
}
