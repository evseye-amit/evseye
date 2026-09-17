import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateClientDomainDto } from './branding.dto.js';
import { ClientResolverService } from './client-resolver.service.js';
import { normalizeHostname, validClientSlug } from './hostname.js';
import { Resolver } from 'node:dns/promises';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
@Controller('platform/clients/:clientId/domains')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class ClientDomainController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientsResolver: ClientResolverService,
  ) {}
  private readonly dns = new Resolver({ timeout: 3000, tries: 2 });

  @Get() async list(@Param('clientId') clientId: string) {
    return {
      data: await this.prisma.clientDomain.findMany({
        where: { clientId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
    };
  }
  @Post() async create(
    @Param('clientId') clientId: string,
    @Body() dto: CreateClientDomainDto,
    @CurrentUser() user: AuthUser,
  ) {
    const hostname = normalizeHostname(dto.hostname);
    if (
      hostname !== dto.hostname.toLowerCase() ||
      this.clientsResolver.genericHosts().includes(hostname)
    )
      throw new BadRequestException('Invalid domain.');
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Client not found.');
    const base = this.clientsResolver
      .baseDomains()
      .find((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    const slug = base ? hostname.slice(0, -(base.length + 1)) : '';
    if (base && (!validClientSlug(slug) || slug !== client.slug))
      throw new BadRequestException('Use this client’s own subdomain.');
    if (
      !base &&
      (!hostname.includes('.') ||
        /^\d+(\.\d+){3}$/.test(hostname) ||
        hostname.endsWith('.localhost'))
    )
      throw new BadRequestException('Invalid custom domain.');
    try {
      return {
        data: await this.prisma.$transaction(async (tx) => {
          const domain = await tx.clientDomain.create({
            data: {
              clientId,
              hostname,
              type: base ? 'EVSEYE_SUBDOMAIN' : 'CUSTOM_DOMAIN',
              isVerified: Boolean(base),
            },
          });
          await tx.auditLog.create({
            data: {
              clientId,
              actorId: user.id,
              action: 'CLIENT_DOMAIN_CREATED',
              entityType: 'ClientDomain',
              entityId: domain.id,
              newData: { hostname, type: domain.type },
            },
          });
          return domain;
        }),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Domain is already registered.');
      throw error;
    }
  }
  @Post(':domainId/verify') async verify(
    @Param('clientId') clientId: string,
    @Param('domainId') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const domain = await this.prisma.clientDomain.findFirst({
      where: { id, clientId },
    });
    if (!domain) throw new NotFoundException('Domain not found.');
    if (domain.type === 'CUSTOM_DOMAIN') {
      const records = await this.dns
        .resolveTxt(`_evseye-verification.${domain.hostname}`)
        .catch(() => []);
      if (
        !records.some(
          (record) =>
            record.join('') ===
            `evseye-verification=${domain.verificationToken}`,
        )
      )
        throw new BadRequestException(
          'DNS ownership verification has not passed.',
        );
    }
    return {
      data: await this.prisma.$transaction(async (tx) => {
        const updated = await tx.clientDomain.update({
          where: { id, clientId },
          data: { isVerified: true },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: user.id,
            action: 'CLIENT_DOMAIN_VERIFIED',
            entityType: 'ClientDomain',
            entityId: id,
          },
        });
        return updated;
      }),
    };
  }
  @Post(':domainId/primary') async primary(
    @Param('clientId') clientId: string,
    @Param('domainId') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const domain = await this.prisma.clientDomain.findFirst({
      where: { id, clientId, isVerified: true },
    });
    if (!domain) throw new NotFoundException('Verified domain not found.');
    return {
      data: await this.prisma.$transaction(async (tx) => {
        await tx.clientDomain.updateMany({
          where: { clientId, isPrimary: true },
          data: { isPrimary: false },
        });
        const updated = await tx.clientDomain.update({
          where: { id, clientId, isVerified: true },
          data: { isPrimary: true },
        });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: user.id,
            action: 'CLIENT_DOMAIN_PRIMARY_CHANGED',
            entityType: 'ClientDomain',
            entityId: id,
          },
        });
        return updated;
      }),
    };
  }
  @Delete(':domainId') async remove(
    @Param('clientId') clientId: string,
    @Param('domainId') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      data: await this.prisma.$transaction(async (tx) => {
        const domain = await tx.clientDomain.findFirst({
          where: { id, clientId },
        });
        if (!domain) throw new NotFoundException('Domain not found.');
        await tx.clientDomain.delete({ where: { id, clientId } });
        await tx.auditLog.create({
          data: {
            clientId,
            actorId: user.id,
            action: 'CLIENT_DOMAIN_REMOVED',
            entityType: 'ClientDomain',
            entityId: id,
            previousData: { hostname: domain.hostname },
          },
        });
        return { count: 1 };
      }),
    };
  }
}
