import { FleetManagerActionGuard, FleetActionResource } from '../auth/guards/fleet-manager-action.guard.js';
import {
  Body,
  Controller,
  Get,
  Header,
  StreamableFile,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PhotoSubjectType, PhotoType, PhotoWorkflowType, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import { UpsertPhotoRequirementDto } from './dto/upsert-photo-requirement.dto.js';
import { MediaService } from './media.service.js';

@Controller('media')
@UseGuards(AccessTokenGuard, RolesGuard, FleetManagerActionGuard)
@FleetActionResource('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly audit: AuditService,
    private readonly clients: ClientContextService,
  ) {}

  @Get('fleets/:fleetId/evidence')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER)
  async fleetEvidence(
    @CurrentUser() user: AuthUser,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ) {
    return {
      data: await this.mediaService.fleetEvidence(
        this.clients.requireClientId(user),
        fleetId,
      ),
    };
  }

  @Get('fleets/:fleetId/evidence/:photoId/content')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async fleetEvidenceContent(
    @CurrentUser() user: AuthUser,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    const image = await this.mediaService.fleetEvidenceContent(
      this.clients.requireClientId(user),
      fleetId,
      photoId,
    );
    return new StreamableFile(image.bytes, {
      type: image.mimeType,
      disposition: `inline; filename="${image.filename}"`,
      length: image.bytes.byteLength,
    });
  }

  @Get('photo-requirements')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async requirements(
    @CurrentUser() user: AuthUser,
    @Query('workFlowType', new ParseEnumPipe(PhotoWorkflowType)) workFlowType: PhotoWorkflowType,
    @Query('subjectType', new ParseEnumPipe(PhotoSubjectType)) subjectType: PhotoSubjectType,
  ) {
    return {
      data: await this.mediaService.requirements(
        this.clients.requireClientId(user),
        workFlowType,
        subjectType,
      ),
    };
  }

  @Get('photos')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async entityPhotos(
    @CurrentUser() user: AuthUser,
    @Query('workFlowType', new ParseEnumPipe(PhotoWorkflowType))
    workFlowType: PhotoWorkflowType,
    @Query('subjectType', new ParseEnumPipe(PhotoSubjectType)) subjectType: PhotoSubjectType,
    @Query('entityId', ParseUUIDPipe) entityId: string,
  ) {
    return {
      data: await this.mediaService.listEntityPhotos(
        this.clients.requireClientId(user),
        workFlowType,
        subjectType,
        entityId,
        user,
      ),
    };
  }

  @Put('photo-requirements/:workFlowType/:subjectType/:photoType')
  @Roles(UserRole.CLIENT_ADMIN)
  async upsertRequirement(
    @CurrentUser() user: AuthUser,
    @Param('workFlowType', new ParseEnumPipe(PhotoWorkflowType))
    workFlowType: PhotoWorkflowType,
    @Param('subjectType', new ParseEnumPipe(PhotoSubjectType)) subjectType: PhotoSubjectType,
    @Param('photoType', new ParseEnumPipe(PhotoType)) photoType: PhotoType,
    @Body() dto: UpsertPhotoRequirementDto,
  ) {
    return {
      data: await this.mediaService.upsertRequirement(
        this.clients.requireClientId(user),
        workFlowType,
        subjectType,
        photoType,
        dto,
      ),
    };
  }

  @Post('upload-intents')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async createUploadIntent(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadIntentDto,
  ) {
    return {
      data: await this.mediaService.createUploadIntent(
        this.clients.requireClientId(user),
        user.id,
        dto,
      ),
    };
  }

  @Post(':id/complete')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const clientId = this.clients.requireClientId(user);
    const photo = await this.mediaService.complete(clientId, id);
    await this.audit.record({
      clientId,
      actorId: user.id,
      action: 'PHOTO_UPLOADED',
      entityType: 'Photo',
      entityId: photo.id,
      newData: {
        photoId: photo.id,
        workFlowType: photo.workFlowType,
        subjectType: photo.subjectType,
        photoType: photo.photoType,
        status: photo.status,
      },
    });
    return {
      data: photo,
    };
  }

  @Get(':id/download-url')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async downloadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return {
      data: await this.mediaService.downloadUrl(
        this.clients.requireClientId(user),
        id,
        user,
      ),
    };
  }
}
