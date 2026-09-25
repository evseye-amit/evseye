import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { AuditModule } from '../audit/audit.module.js';
import { ClientWelcomeService } from './client-welcome.service.js';
import { DisabledEmailProvider } from './disabled-email.provider.js';
import { EMAIL_PROVIDER } from './email-provider.interface.js';
import { Msg91EmailProvider } from './msg91-email.provider.js';

@Module({
  imports: [AuditModule],
  providers: [
    ClientWelcomeService,
    DisabledEmailProvider,
    Msg91EmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, DisabledEmailProvider, Msg91EmailProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        disabled: DisabledEmailProvider,
        msg91: Msg91EmailProvider,
      ) => config.getOrThrow('EMAIL_PROVIDER') === 'msg91' ? msg91 : disabled,
    },
  ],
  exports: [ClientWelcomeService],
})
export class EmailModule {}
