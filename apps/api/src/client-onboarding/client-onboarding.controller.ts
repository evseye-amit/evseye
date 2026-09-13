import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ClientOnboardingService } from './client-onboarding.service.js';
import {
  SaveOnboardingStepDto,
  SkipOnboardingStepDto,
} from './dto/onboarding.dto.js';

@Controller('client')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class ClientOnboardingController {
  constructor(
    private readonly onboarding: ClientOnboardingService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('bootstrap') bootstrap(@CurrentUser() user: AuthUser) {
    return this.onboarding
      .bootstrap(this.clients.requireClientId(user))
      .then((data) => ({ data }));
  }
  @Get('onboarding/progress') progress(@CurrentUser() user: AuthUser) {
    return this.onboarding
      .progress(this.clients.requireClientId(user))
      .then((data) => ({ data }));
  }
  @Post('onboarding/steps') save(
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveOnboardingStepDto,
  ) {
    return this.onboarding
      .saveStep(
        this.clients.requireClientId(user),
        user.id,
        dto.step,
        dto.status,
      )
      .then((data) => ({ data }));
  }
  @Post('onboarding/steps/skip') skip(
    @CurrentUser() user: AuthUser,
    @Body() dto: SkipOnboardingStepDto,
  ) {
    return this.onboarding
      .saveStep(
        this.clients.requireClientId(user),
        user.id,
        dto.step,
        'SKIPPED',
      )
      .then((data) => ({ data }));
  }
  @Post('onboarding/submit') submit(@CurrentUser() user: AuthUser) {
    return this.onboarding
      .submit(this.clients.requireClientId(user), user.id)
      .then((data) => ({ data }));
  }
}
