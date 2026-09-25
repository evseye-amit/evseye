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
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RequestLoginOtpDto } from './dto/request-login-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import type { AuthUser } from './interfaces/auth-user.interface.js';

@Controller('auth')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'Response language: en-IN, hi-IN, te-IN, or kn-IN. Defaults to English.' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly clientsResolver: ClientResolverService,
  ) {}

  @Header('Cache-Control', 'no-store')
  @Post('otp/request')
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
    );
    return { data };
  }

  @Header('Cache-Control', 'no-store')
  @Post('otp/verify')
  async verifyLoginOtp(
    @Body() dto: VerifyOtpDto,
    @Req() request: FastifyRequest,
  ) {
    return {
      data: await this.authService.verifyLoginOtp(
        dto.otpRequestId,
        dto.code,
        (await this.clientsResolver.fromRequest(request))?.clientId,
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
