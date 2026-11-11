import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CreateSupportReplyDto, CreateSupportTicketDto, ListSupportTicketsDto, SupportAttachmentIntentDto, UpdateSupportStatusDto } from './dto/support.dto.js';
import { SupportService } from './support.service.js';

const staffRoles = [UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER];

@Controller('client/support/tickets')
@ApiTags('Client Operations · Support')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(...staffRoles)
export class SupportController {
  constructor(private readonly context: ClientContextService, private readonly support: SupportService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListSupportTicketsDto) {
    return { data: await this.support.list(this.context.requireClientId(user), user, query) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.support.get(this.context.requireClientId(user), user, id) };
  }

  @Post(':id/replies')
  async reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateSupportReplyDto) {
    return { data: await this.support.reply(this.context.requireClientId(user), user, id, dto) };
  }

  @Patch(':id/status')
  async status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSupportStatusDto) {
    return { data: await this.support.updateStatus(this.context.requireClientId(user), user, id, dto) };
  }

  @Post(':id/attachments/upload-intent')
  async attachmentIntent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SupportAttachmentIntentDto) {
    return { data: await this.support.attachmentIntent(this.context.requireClientId(user), user, id, dto) };
  }

  @Post(':id/attachments/:photoId/complete')
  async completeAttachment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    return { data: await this.support.completeAttachment(this.context.requireClientId(user), user, id, photoId) };
  }

  @Get(':id/attachments/:photoId/download-url')
  async downloadAttachment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    return { data: await this.support.attachmentDownloadUrl(this.context.requireClientId(user), user, id, photoId) };
  }
}

@Controller('rider-app/support/tickets')
@ApiTags('Rider App')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderSupportController {
  constructor(private readonly context: ClientContextService, private readonly support: SupportService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSupportTicketDto) {
    return { data: await this.support.create(this.context.requireClientId(user), user, dto) };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListSupportTicketsDto) {
    return { data: await this.support.list(this.context.requireClientId(user), user, query) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.support.get(this.context.requireClientId(user), user, id) };
  }

  @Post(':id/replies')
  async reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateSupportReplyDto) {
    return { data: await this.support.reply(this.context.requireClientId(user), user, id, dto) };
  }

  @Post(':id/attachments/upload-intent')
  async attachmentIntent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SupportAttachmentIntentDto) {
    return { data: await this.support.attachmentIntent(this.context.requireClientId(user), user, id, dto) };
  }

  @Post(':id/attachments/:photoId/complete')
  async completeAttachment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    return { data: await this.support.completeAttachment(this.context.requireClientId(user), user, id, photoId) };
  }

  @Get(':id/attachments/:photoId/download-url')
  async downloadAttachment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    return { data: await this.support.attachmentDownloadUrl(this.context.requireClientId(user), user, id, photoId) };
  }
}
