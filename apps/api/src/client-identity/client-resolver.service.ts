import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  normalizeHostname,
  RESERVED_SUBDOMAINS,
  validClientSlug,
} from './hostname.js';

export interface ResolvedClient {
  clientId: string;
  companyCode: string;
  hostname: string;
}
@Injectable()
export class ClientResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  baseDomains(): string[] {
    return (this.config.get<string>('APP_BASE_DOMAINS') ?? 'localhost')
      .split(',')
      .map((value) => normalizeHostname(value.trim()));
  }
  genericHosts(): string[] {
    return (
      this.config.get<string>('APP_GENERIC_HOSTS') ?? 'localhost,127.0.0.1'
    )
      .split(',')
      .map((value) => normalizeHostname(value.trim()));
  }
  async resolve(input: string): Promise<ResolvedClient | null> {
    const hostname = normalizeHostname(input);
    if (this.genericHosts().includes(hostname)) return null;
    const base = this.baseDomains().find(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    const slug =
      base && hostname !== base ? hostname.slice(0, -(base.length + 1)) : '';
    if (base && (!slug || RESERVED_SUBDOMAINS.has(slug))) return null;
    // Deliberately uncached: status/verification revocations take effect on the next request
    // across all replicas. This repository boundary can be replaced by an invalidating cache.
    const mapping = await this.prisma.clientDomain.findUnique({
      where: { hostname },
    });
    let clientId = mapping?.clientId;
    if (mapping && !mapping.isVerified)
      throw new NotFoundException('Workspace unavailable.');
    if (!mapping && base && validClientSlug(slug)) {
      const client = await this.prisma.client.findUnique({
        where: { slug },
        select: { id: true },
      });
      clientId = client?.id;
    }
    if (!clientId) throw new NotFoundException('Workspace unavailable.');
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        isActive: true,
        status: { notIn: ['DRAFT', 'SUSPENDED'] },
      },
      select: { id: true, companyCode: true, slug: true },
    });
    if (!client) throw new NotFoundException('Workspace unavailable.');
    return {
      clientId: client.id,
      companyCode: client.companyCode ?? client.slug,
      hostname,
    };
  }
  async fromRequest(
    request: Pick<FastifyRequest, 'headers'>,
  ): Promise<ResolvedClient | null> {
    const forwarded = request.headers['x-client-host'];
    if (forwarded !== undefined) {
      const secret = this.config.get<string>('CLIENT_PROXY_SECRET');
      const supplied = request.headers['x-client-proxy-secret'];
      if (
        !secret ||
        typeof supplied !== 'string' ||
        Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
        !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)) ||
        typeof forwarded !== 'string'
      )
        throw new ForbiddenException('Invalid client gateway.');
      return this.resolve(forwarded);
    }
    const hostContext = await this.resolve(request.headers.host ?? '');
    if (request.headers.origin) {
      let origin: URL;
      try {
        origin = new URL(request.headers.origin);
      } catch {
        throw new ForbiddenException('Invalid origin.');
      }
      if (!['http:', 'https:'].includes(origin.protocol))
        throw new ForbiddenException('Invalid origin.');
      const originContext = await this.resolve(origin.host);
      if (hostContext && originContext?.clientId !== hostContext.clientId)
        throw new ForbiddenException('Workspace mismatch.');
      return hostContext ?? originContext;
    }
    return hostContext;
  }
  assertMatches(context: ResolvedClient | null, clientId: string | null): void {
    if (context && context.clientId !== clientId)
      throw new ForbiddenException(
        'This account cannot access this workspace.',
      );
  }
}
