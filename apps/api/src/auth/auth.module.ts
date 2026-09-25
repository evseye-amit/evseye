import { ClientResolutionModule } from '../client-identity/client-resolution.module.js';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { ConsoleSmsProvider } from './sms/console-sms.provider.js';
import { TelipiaSmsProvider } from './sms/telipia-sms.provider.js';
import { SMS_PROVIDER } from './sms/sms-provider.interface.js';
import { ClientContextService } from './client-context.service.js';
import type { Environment } from '../config/environment.js';

@Module({
  imports: [JwtModule.register({}), ClientResolutionModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    RolesGuard,
    ClientContextService,
    ConsoleSmsProvider,
    TelipiaSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, ConsoleSmsProvider, TelipiaSmsProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        consoleProvider: ConsoleSmsProvider,
        telipiaProvider: TelipiaSmsProvider,
      ) => {
        const provider = config.getOrThrow('SMS_PROVIDER');
        if (provider === 'console') return consoleProvider;
        if (provider === 'telipia') return telipiaProvider;
        throw new Error(`Unsupported SMS_PROVIDER: ${provider}`);
      },
    },
  ],
  exports: [
    JwtModule,
    ClientResolutionModule,
    AuthService,
    AccessTokenGuard,
    RolesGuard,
    ClientContextService,
  ],
})
export class AuthModule {}
