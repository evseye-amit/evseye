import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PlatformAdminService } from './platform-admin.service.js';

@Controller('client-branding')
export class ClientBrandingController {
  constructor(private readonly platform: PlatformAdminService) {}

  @Get('public')
  @Header('Cache-Control', 'no-store')
  async publicBranding(@Query('companyCode') companyCode: string) {
    return { data: await this.platform.clientBranding(undefined, companyCode) };
  }

  @Get()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'no-store')
  async branding(@CurrentUser() user: AuthUser) {
    return { data: user.clientId ? await this.platform.clientBranding(user.clientId) : null };
  }
}
