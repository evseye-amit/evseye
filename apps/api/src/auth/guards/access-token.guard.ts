import { PrismaService } from '../../prisma/prisma.service.js';
import { ClientResolverService } from '../../client-identity/client-resolver.service.js';
import {
  ForbiddenException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import type { Environment } from '../../config/environment.js';
import type { AuthUser } from '../interfaces/auth-user.interface.js';

interface AccessTokenPayload extends AuthUser {
  typ: 'access';
  sid: string;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Environment, true>,
    private readonly prisma: PrismaService,
    private readonly clientsResolver: ClientResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthUser }>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing access token.');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        {
          secret: this.configService.getOrThrow('JWT_ACCESS_SECRET'),
        },
      );

      if (payload.typ !== 'access' || !payload.id || !payload.sid) {
        throw new UnauthorizedException('Invalid access token.');
      }

      const session = await this.prisma.session.findFirst({ where: { id: payload.sid, userId: payload.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (!session) throw new UnauthorizedException('Session is unavailable.');
      const user = await this.prisma.user.findFirst({
        where: {
          id: payload.id,
          clientId: payload.clientId ?? null,
          isActive: true,
          deletedAt: null,
        },
        include: { client: true },
      });
      if (
        !user ||
        (user.clientId &&
          (!user.client?.isActive ||
            ['DRAFT', 'SUSPENDED'].includes(user.client.status)))
      )
        throw new UnauthorizedException('Account is unavailable.');
      const clientContext = await this.clientsResolver.fromRequest(request);
      if (clientContext && clientContext.clientId !== user.clientId) {
        request.log?.warn({ event: 'client_context_denied', action: 'authorize', clientId: user.clientId, requestedClientId: clientContext.clientId, userId: user.id, requestId: request.id, route: request.routeOptions?.url });
      }
      this.clientsResolver.assertMatches(clientContext, user.clientId);
      request.user = {
        id: user.id,
        clientId: user.clientId,
        roles: [user.role],
      };
      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }
}
