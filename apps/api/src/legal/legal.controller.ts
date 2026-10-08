import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, IsISO8601, Length, Matches } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { ClientResolverService } from '../client-identity/client-resolver.service.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { LegalService } from './legal.service.js';

class CurrentLegalQuery {
  @IsString() @Length(1, 80) companyCode!: string;
  @IsString() @Length(1, 40) appCode!: string;
  @IsEnum(UserRole) role!: UserRole;
  @IsIn(['TERMS_AND_CONDITIONS']) kind!: string;
  @Matches(/^[a-z]{2}$/) locale!: string;
}

class AcceptLegalBody {
  @IsUUID() documentId!: string;
  @IsString() @Length(64, 64) contentHash!: string;
  @IsOptional() @IsString() @Length(1, 128) deviceId?: string;
  @IsOptional() @IsISO8601() deviceAcceptedAt?: string;
}

class PublishLegalBody {
  @IsOptional() @IsUUID() clientId?: string;
  @IsString() @Length(1, 40) appCode!: string;
  @IsEnum(UserRole) role!: UserRole;
  @IsIn(['TERMS_AND_CONDITIONS']) kind!: string;
  @Matches(/^[a-z]{2}$/) locale!: string;
  @IsString() @Length(1, 80) version!: string;
  @IsString() @Length(1, 200) title!: string;
  @IsString() @Length(1, 100000) content!: string;
  @IsISO8601() effectiveAt!: string;
}

@Controller('public/legal')
export class PublicLegalController {
  constructor(private readonly legal: LegalService, private readonly resolver: ClientResolverService) {}

  @Get('current')
  @Header('Cache-Control', 'no-store')
  async current(@Query() query: CurrentLegalQuery, @Req() request: FastifyRequest) {
    const resolved = await this.resolver.fromRequest(request);
    const clientId = await this.legal.clientIdForCode(query.companyCode, resolved?.clientId);
    return { data: await this.legal.current(clientId, query.appCode, query.role, query.kind, query.locale) };
  }
}

@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Post('acceptances')
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'no-store')
  async accept(@CurrentUser() user: AuthUser, @Body() body: AcceptLegalBody) {
    if (!user.clientId) throw new Error('User is not associated with a client.');
    return { data: await this.legal.accept(user.clientId, user.id, user.roles, body) };
  }
}

@Controller('legal/documents')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.CLIENT_ADMIN)
export class LegalAdminController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { data: await this.legal.list(user.clientId, user.roles.includes(UserRole.SUPER_ADMIN)) };
  }

  @Post('drafts')
  async createDraft(@CurrentUser() user: AuthUser, @Body() body: PublishLegalBody) {
    const platformAdmin = user.roles.includes(UserRole.SUPER_ADMIN);
    if (!platformAdmin && body.clientId && body.clientId !== user.clientId)
      throw new ForbiddenException('Client mismatch.');
    const clientId = platformAdmin ? body.clientId ?? null : user.clientId;
    if (!platformAdmin && !clientId) throw new ForbiddenException('Client required.');
    return { data: await this.legal.createDraft(clientId, body) };
  }

  @Patch(':id')
  async updateDraft(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: PublishLegalBody) {
    return { data: await this.legal.updateDraft(id, user.clientId, user.roles.includes(UserRole.SUPER_ADMIN), body) };
  }

  @Post(':id/publish')
  async publishDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.legal.publishDraft(id, user.clientId, user.roles.includes(UserRole.SUPER_ADMIN)) };
  }

  @Delete(':id')
  async deleteDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.legal.deleteDraft(id, user.clientId, user.roles.includes(UserRole.SUPER_ADMIN)) };
  }

  @Post()
  async publish(@CurrentUser() user: AuthUser, @Body() body: PublishLegalBody) {
    const platformAdmin = user.roles.includes(UserRole.SUPER_ADMIN);
    if (!platformAdmin && body.clientId && body.clientId !== user.clientId)
      throw new ForbiddenException('Client mismatch.');
    const clientId = platformAdmin ? body.clientId ?? null : user.clientId;
    if (!platformAdmin && !clientId) throw new ForbiddenException('Client required.');
    return { data: await this.legal.publish(clientId, body) };
  }

  @Post(':id/retire')
  async retire(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.legal.retire(id, user.clientId, user.roles.includes(UserRole.SUPER_ADMIN)) };
  }
}
