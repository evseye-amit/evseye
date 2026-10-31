import { FleetManagerActionGuard } from './guards/fleet-manager-action.guard.js';
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
import { FailoverSmsProvider } from './sms/failover-sms.provider.js';
import { SMS_PROVIDER } from './sms/sms-provider.interface.js';
import { ClientContextService } from './client-context.service.js';
import { SmsQuotaService } from './sms-quota.service.js';
import { LoginFlowService } from './login-flow.service.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import type { Environment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  imports: [JwtModule.register({}), ClientResolutionModule, WorkflowModule],
  controllers: [AuthController],
  providers: [
    FleetManagerActionGuard,
    AuthService,
    SmsQuotaService,
    LoginFlowService,
    AccessTokenGuard,
    RolesGuard,
    ClientContextService,
    ConsoleSmsProvider,
    TelipiaSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, ConsoleSmsProvider, TelipiaSmsProvider, PrismaService],
      useFactory: (
        config: ConfigService<Environment, true>,
        consoleProvider: ConsoleSmsProvider,
        telipiaProvider: TelipiaSmsProvider,
        prisma: PrismaService,
      ) => {
        const provider = config.getOrThrow('SMS_PROVIDER');
        const primary = provider === 'console' ? consoleProvider : provider === 'telipia' ? telipiaProvider : null;
        if (!primary) throw new Error(`Unsupported SMS_PROVIDER: ${provider}`);
        const fallbackName = config.getOrThrow('SMS_FALLBACK_PROVIDER');
        const fallback = fallbackName === 'none' || fallbackName === provider ? undefined : fallbackName === 'console' ? consoleProvider : telipiaProvider;
        return new FailoverSmsProvider(primary, fallback, prisma, { console: consoleProvider, telipia: telipiaProvider });
      },
    },
  ],
  exports: [
    FleetManagerActionGuard,
    JwtModule,
    ClientResolutionModule,
    AuthService,
    AccessTokenGuard,
    RolesGuard,
    ClientContextService,
  ],
})
export class AuthModule {}
