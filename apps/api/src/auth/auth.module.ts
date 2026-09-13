import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { ConsoleSmsProvider } from './sms/console-sms.provider.js';
import { SMS_PROVIDER } from './sms/sms-provider.interface.js';
import { ClientContextService } from './client-context.service.js';
import type { Environment } from '../config/environment.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    RolesGuard,
    ClientContextService,
    ConsoleSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, ConsoleSmsProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        consoleProvider: ConsoleSmsProvider,
      ) => {
        const provider = config.getOrThrow('SMS_PROVIDER');
        if (provider === 'console') return consoleProvider;
        throw new Error(`Unsupported SMS_PROVIDER: ${provider}`);
      },
    },
  ],
  exports: [
    JwtModule,
    AuthService,
    AccessTokenGuard,
    RolesGuard,
    ClientContextService,
  ],
})
export class AuthModule {}
