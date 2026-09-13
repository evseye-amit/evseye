import {
  Body,
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
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Header('Cache-Control', 'no-store')
  @Post('otp/request')
  @HttpCode(202)
  async requestLoginOtp(@Body() dto: RequestLoginOtpDto, @Ip() ip: string) {
    const data = await this.authService.requestLoginOtp(
      dto.phone,
      dto.companyCode ?? dto.clientSlug ?? dto.tenantSlug,
      ip,
    );
    return { data };
  }

  @Header('Cache-Control', 'no-store')
  @Post('otp/verify')
  async verifyLoginOtp(@Body() dto: VerifyOtpDto) {
    return {
      data: await this.authService.verifyLoginOtp(dto.otpRequestId, dto.code),
    };
  }

  @Header('Cache-Control', 'no-store')
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return { data: await this.authService.refresh(dto.refreshToken) };
  }

  @Header('Cache-Control', 'no-store')
  @Post('logout')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.revokeSession(dto.refreshToken);
  }

  @Header('Cache-Control', 'no-store')
  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthUser) {
    return { data: user };
  }
}
