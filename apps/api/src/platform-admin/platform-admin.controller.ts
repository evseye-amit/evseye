import {
  Body,
  Controller,
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
import { CreateOnboardingConfigDto } from './dto/create-onboarding-config.dto.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpsertOnboardingConfigStepsDto } from './dto/upsert-onboarding-config-steps.dto.js';
import { PlatformAdminService } from './platform-admin.service.js';

@Controller('platform')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}
  @Get('tenants') listTenants() {
    return this.platform.listTenants().then((data) => ({ data }));
  }
  @Post('tenants') createTenant(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform.createTenant(dto, user.id).then((data) => ({ data }));
  }
  @Get('onboarding/step-definitions') stepDefinitions() {
    return this.platform.listStepDefinitions().then((data) => ({ data }));
  }
  @Get('tenants/:tenantId/onboarding-configs') configs(
    @Param('tenantId') tenantId: string,
  ) {
    return this.platform.listConfigs(tenantId).then((data) => ({ data }));
  }
  @Post('tenants/:tenantId/onboarding-configs') createConfig(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateOnboardingConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .createConfig(tenantId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Put('onboarding-configs/:configId/steps') steps(
    @Param('configId') configId: string,
    @Body() dto: UpsertOnboardingConfigStepsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .upsertConfigSteps(configId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Post('onboarding-configs/:configId/activate') activate(
    @Param('configId') configId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .activateConfig(configId, user.id)
      .then((data) => ({ data }));
  }
}
