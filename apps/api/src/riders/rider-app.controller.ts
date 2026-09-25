import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiHeader } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderAppEnrollDto, SaveRiderAppStepDto } from './dto/rider-app.dto.js';
import { RiderDocumentUploadIntentDto } from './dto/rider-document.dto.js';
import { RiderAppService } from './rider-app.service.js';
import { requestLocale } from '../common/locale.js';

@Controller('rider-app')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'Response language: en-IN, hi-IN, te-IN, or kn-IN. Defaults to English.' })
export class RiderAppController {
  constructor(private readonly riderApp: RiderAppService) {}

  @Post('enroll')
  async enroll(@Body() dto: RiderAppEnrollDto) { return { data: await this.riderApp.enroll(dto.companyCode, dto.phone) }; }

  @Get('onboarding')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async onboarding(@CurrentUser() user: AuthUser, @Headers('accept-language') language?: string) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.onboarding(user.clientId, user.id, requestLocale(language)) };
  }

  @Post('onboarding/documents/upload-intent')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async documentUploadIntent(@CurrentUser() user: AuthUser, @Body() dto: RiderDocumentUploadIntentDto) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.createDocumentUploadIntent(user.clientId, user.id, dto) };
  }

  @Post('onboarding/documents/:photoId/complete')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async completeDocumentUpload(@CurrentUser() user: AuthUser, @Param('photoId') photoId: string) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.completeDocumentUpload(user.clientId, user.id, photoId) };
  }

  @Post('onboarding/steps')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async save(@CurrentUser() user: AuthUser, @Body() dto: SaveRiderAppStepDto, @Headers('accept-language') language?: string) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.saveStep(user.clientId, user.id, dto.stepId, dto.values, false, requestLocale(language)) };
  }

  @Post('onboarding/steps/skip')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.RIDER)
  async skip(@CurrentUser() user: AuthUser, @Body() dto: SaveRiderAppStepDto, @Headers('accept-language') language?: string) {
    if (!user.clientId) throw new Error('Rider is not associated with a client.');
    return { data: await this.riderApp.saveStep(user.clientId, user.id, dto.stepId, dto.values, true, requestLocale(language)) };
  }
}
