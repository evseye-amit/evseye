import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { ConsoleSmsProvider } from './sms/console-sms.provider.js';
import { SMS_PROVIDER } from './sms/sms-provider.interface.js';
import { TenantContextService } from './tenant-context.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    RolesGuard,
    TenantContextService,
    ConsoleSmsProvider,
    { provide: SMS_PROVIDER, useExisting: ConsoleSmsProvider },
  ],
  exports: [AuthService, AccessTokenGuard, RolesGuard, TenantContextService],
})
export class AuthModule {}
