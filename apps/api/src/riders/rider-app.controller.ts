import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderAppEnrollDto, SaveRiderAppStepDto } from './dto/rider-app.dto.js';
import { RiderAppService } from './rider-app.service.js';

@Controller('rider-app')
export class RiderAppController {
  constructor(private readonly riderApp: RiderAppService) {}

  @Post('enroll')
  async enroll(@Body() dto: RiderAppEnrollDto) { return { data: await this.riderApp.enroll(dto.companyCode, dto.phone) }; }

  @Get('onboarding')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async onboarding(@CurrentUser() user: AuthUser) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.onboarding(user.clientId, user.id) };
  }

  @Post('onboarding/steps')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async save(@CurrentUser() user: AuthUser, @Body() dto: SaveRiderAppStepDto) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.saveStep(user.clientId, user.id, dto.stepId, dto.values) };
  }

  @Post('onboarding/steps/skip')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async skip(@CurrentUser() user: AuthUser, @Body() dto: SaveRiderAppStepDto) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.saveStep(user.clientId, user.id, dto.stepId, dto.values, true) };
  }
}
