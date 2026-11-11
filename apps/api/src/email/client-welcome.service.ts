import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.interface.js';

export interface WelcomeAccount {
  clientId: string;
  clientName: string;
  companyName: string;
  companyCode: string;
  mobile: string;
  email?: string | null;
}

export interface WelcomeEmailResult {
  status: 'accepted' | 'failed' | 'not_configured' | 'missing_recipient';
  message: string;
}

@Injectable()
export class ClientWelcomeService {
  private readonly logger = new Logger(ClientWelcomeService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async send(
    account: WelcomeAccount,
    actorId: string,
  ): Promise<WelcomeEmailResult> {
    let result: WelcomeEmailResult;
    const loginUrl = this.config.get<string>('CLIENT_LOGIN_URL');
    if (!account.email) {
      result = {
        status: 'missing_recipient',
        message: 'Welcome email was not sent: Account Admin email is missing.',
      };
    } else if (
      !this.emailProvider.isConfigured() ||
      !loginUrl
    ) {
      result = {
        status: 'not_configured',
        message: 'Welcome email was not sent: configure the email provider and login URL.',
      };
    } else {
      try {
        await this.emailProvider.sendWelcome({
          recipientEmail: account.email,
          recipientName: account.clientName,
          companyName: account.companyName,
          companyCode: account.companyCode,
          registeredMobileNumber: account.mobile,
          loginUrl,
        });
        result = {
          status: 'accepted',
          message: 'Welcome email accepted for delivery.',
        };
      } catch {
        // Never roll back a created account or expose credentials/provider payloads on email failure.
        result = {
          status: 'failed',
          message:
            'Client account is ready, but the welcome email could not be sent. Check the email provider before retrying delivery.',
        };
      }
    }
    try {
      await this.audit.record({
        actorId,
        clientId: account.clientId,
        entityType: 'Client',
        entityId: account.clientId,
        action: 'CLIENT_WELCOME_EMAIL',
        newData: { status: result.status },
      });
    } catch {
      this.logger.error(
        `Unable to record welcome email status for client ${account.clientId}`,
      );
    }
    return result;
  }
}
