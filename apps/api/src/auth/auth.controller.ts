import type { FastifyRequest } from 'fastify';
import { ApiHeader } from '@nestjs/swagger';
import { ClientResolverService } from '../client-identity/client-resolver.service.js';
import {
  Body,
  Req,
  Controller,
  Get,
  Header,
  HttpCode,
  Ip,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Roles } from './decorators/roles.decorator.js';
import { RolesGuard } from './guards/roles.guard.js';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RequestLoginOtpDto } from './dto/request-login-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import type { AuthUser } from './interfaces/auth-user.interface.js';
import { LoginFlowService } from './login-flow.service.js';
import { requestLocale } from '../common/locale.js';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'Response language: en-IN, hi-IN, te-IN, or kn-IN. Defaults to English.' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly clientsResolver: ClientResolverService,
    private readonly loginFlow: LoginFlowService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('sms-policy')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  smsPolicy() {
    return this.prisma.smsProviderPolicy.findUnique({ where: { id: 'default' } }).then((policy) => ({ data: policy ?? { id: 'default', primaryProvider: this.config.get<string>('SMS_PROVIDER'), fallbackProvider: this.config.get<string>('SMS_FALLBACK_PROVIDER'), maxAttempts: 2, retryableFailures: ['TIMEOUT', 'UNAVAILABLE', 'RATE_LIMITED'] } }));
  }

  @Post('sms-policy')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  async updateSmsPolicy(@CurrentUser() user: AuthUser, @Body() body: { primaryProvider: string; fallbackProvider?: string | null; maxAttempts?: number }) {
    const allowed = new Set(['console', 'telipia']);
    if (!allowed.has(body.primaryProvider) || (body.fallbackProvider && !allowed.has(body.fallbackProvider))) throw new Error('Unsupported SMS provider.');
    if (body.fallbackProvider === body.primaryProvider) throw new Error('Fallback provider must differ from primary provider.');
    const previous = await this.prisma.smsProviderPolicy.findUnique({ where: { id: 'default' } });
    const policy = await this.prisma.smsProviderPolicy.upsert({ where: { id: 'default' }, create: { id: 'default', primaryProvider: body.primaryProvider, fallbackProvider: body.fallbackProvider ?? null, maxAttempts: Math.min(Math.max(body.maxAttempts ?? 2, 1), 5), updatedById: user.id }, update: { primaryProvider: body.primaryProvider, fallbackProvider: body.fallbackProvider ?? null, maxAttempts: Math.min(Math.max(body.maxAttempts ?? 2, 1), 5), updatedById: user.id } });
    await this.prisma.auditLog.create({ data: { clientId: null, actorId: user.id, action: 'SMS_PROVIDER_POLICY_UPDATED', entityType: 'SMS_PROVIDER_POLICY', entityId: policy.id, previousData: previous ?? undefined, newData: policy } });
    return { data: policy };
  }

  @Get('sms-deliveries')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.CLIENT_ADMIN)
  async smsDeliveries(@CurrentUser() user: AuthUser, @Query('limit') limit = '50', @Query('clientId') clientId?: string, @Query('provider') provider?: string, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const rows = await this.prisma.smsDelivery.findMany({
      where: { ...(user.roles.includes(UserRole.CLIENT_ADMIN) ? { otpRequest: { clientId: user.clientId ?? undefined } } : clientId ? { otpRequest: { clientId } } : {}), ...(provider ? { provider } : {}), ...(status ? { status } : {}), ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(Number(limit) || 50, 1), 200),
      select: { id: true, provider: true, status: true, attempt: true, errorCode: true, createdAt: true, completedAt: true, otpRequest: { select: { phone: true, purpose: true, context: true, clientId: true } } },
    });
    return {
      data: rows.map(({ otpRequest, ...delivery }) => ({
        ...delivery,
        otpRequest: {
          phone: otpRequest.phone,
          purpose: otpRequest.purpose,
          appCode:
            otpRequest.context &&
            typeof otpRequest.context === 'object' &&
            !Array.isArray(otpRequest.context) &&
            typeof otpRequest.context.loginAppCode === 'string'
              ? otpRequest.context.loginAppCode
              : null,
          clientId: otpRequest.clientId,
        },
      })),
    };
  }

  @Header('Cache-Control', 'no-store')
  @Get('login-flow')
  async loginConfiguration(
    @Query('appCode') appCode: string,
    @Query('companyCode') companyCode: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const client = await this.clientsResolver.fromRequest(request);
    return { data: await this.loginFlow.resolve(client?.companyCode ?? companyCode ?? '', appCode,
      requestLocale(request.headers['accept-language'])) };
  }

  @Header('Cache-Control', 'no-store')
  @Post('otp/request')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(202)
  async requestLoginOtp(
    @Body() dto: RequestLoginOtpDto,
    @Ip() ip: string,
    @Req() request: FastifyRequest,
  ) {
    const clientContext = await this.clientsResolver.fromRequest(request);
    const data = await this.authService.requestLoginOtp(
      dto.phone,
      clientContext?.companyCode ?? dto.companyCode ?? dto.clientSlug,
      ip,
      clientContext?.clientId,
      dto.appCode,
    );
    return { data };
  }

  @Header('Cache-Control', 'no-store')
  @Post('otp/verify')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyLoginOtp(
    @Body() dto: VerifyOtpDto,
    @Req() request: FastifyRequest,
  ) {
    return {
      data: await this.authService.verifyLoginOtp(
        dto.otpRequestId,
        dto.code,
        (await this.clientsResolver.fromRequest(request))?.clientId,
        dto.appCode,
      ),
    };
  }

  @Header('Cache-Control', 'no-store')
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: FastifyRequest) {
    return {
      data: await this.authService.refresh(
        dto.refreshToken,
        (await this.clientsResolver.fromRequest(request))?.clientId,
      ),
    };
  }

  @Header('Cache-Control', 'no-store')
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshTokenDto, @Req() request: FastifyRequest): Promise<void> {
    await this.authService.revokeSession(dto.refreshToken, (await this.clientsResolver.fromRequest(request))?.clientId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthUser) {
    return { data: user };
  }
}
