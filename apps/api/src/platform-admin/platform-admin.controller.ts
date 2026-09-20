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
import { CreateClientDto } from './dto/create-client.dto.js';
import {
  CreateClientDocumentUploadIntentDto,
  CreateClientDraftDto,
  UpdateClientAgreementDto,
  UpdateClientBillingDto,
  UpdateClientBusinessDetailsDto,
  UpdateClientContactsAndAddressDto,
  UpdateClientOperationsDto,
  UpdateClientPackageSelectionDto,
} from './dto/client-onboarding-steps.dto.js';
import { RejectClientDto } from './dto/reject-client.dto.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { ClientLogoUploadDto, CompleteClientLogoDto } from './dto/client-logo.dto.js';

@Controller('platform')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}
  @Post('clients/:clientId/logo-upload-intents') logoUploadIntent(
    @Param('clientId') clientId: string, @Body() dto: ClientLogoUploadDto,
  ) {
    return this.platform.createClientLogoUpload(clientId, dto).then((data) => ({ data }));
  }
  @Post('clients/:clientId/logo-upload-complete') completeLogoUpload(
    @Param('clientId') clientId: string, @Body() dto: CompleteClientLogoDto, @CurrentUser() user: AuthUser,
  ) {
    return this.platform.completeClientLogoUpload(clientId, dto, user.id).then((data) => ({ data }));
  }
  @Get('clients') listClients() {
    return this.platform.listClients().then((data) => ({ data }));
  }
  @Post('clients') createClient(
    @Body() dto: CreateClientDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform.createClient(dto, user.id).then((data) => ({ data }));
  }
  @Post('clients/drafts') createClientDraft(
    @Body() dto: CreateClientDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .createClientDraft(dto, user.id)
      .then((data) => ({ data }));
  }
  @Get('clients/:clientId') clientDetail(@Param('clientId') clientId: string) {
    return this.platform.clientDetail(clientId).then((data) => ({ data }));
  }
  @Patch('clients/:clientId/business-details')
  businessDetails(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientBusinessDetailsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .saveBusinessDetails(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Get('clients/:clientId/entitlements') clientEntitlements(
    @Param('clientId') clientId: string,
  ) {
    return this.platform
      .clientEntitlements(clientId)
      .then((data) => ({ data }));
  }
  @Patch('clients/:clientId/contacts-addresses') contactsAndAddresses(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientContactsAndAddressDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .saveContactsAndAddress(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Patch('clients/:clientId/fleet-operations') fleetOperations(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientOperationsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .saveOperations(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Patch('clients/:clientId/package-selection') packageSelection(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientPackageSelectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .savePackageSelection(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Patch('clients/:clientId/billing') billing(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientBillingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .saveBilling(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Post('clients/:clientId/documents/upload-intents') documentUploadIntent(
    @Param('clientId') clientId: string,
    @Body() dto: CreateClientDocumentUploadIntentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .createDocumentUploadIntent(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Post('clients/:clientId/documents/:documentId/complete')
  completeDocumentUpload(
    @Param('clientId') clientId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .completeDocumentUpload(clientId, documentId, user.id)
      .then((data) => ({ data }));
  }
  @Get('clients/:clientId/documents/:documentId/download-url')
  documentDownloadUrl(
    @Param('clientId') clientId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.platform
      .documentDownloadUrl(clientId, documentId)
      .then((data) => ({ data }));
  }
  @Patch('clients/:clientId/agreement') agreement(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientAgreementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .saveAgreement(clientId, dto, user.id)
      .then((data) => ({ data }));
  }
  @Post('clients/:clientId/submit') submitClient(
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .submitClient(clientId, user.id)
      .then((data) => ({ data }));
  }
  @Post('clients/:clientId/approve') approveClient(
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .approveClient(clientId, user.id)
      .then((data) => ({ data }));
  }
  @Post('clients/:clientId/reject') rejectClient(
    @Param('clientId') clientId: string,
    @Body() dto: RejectClientDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform
      .rejectClient(clientId, dto.reason, user.id)
      .then((data) => ({ data }));
  }
}
