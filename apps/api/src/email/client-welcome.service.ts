import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';

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
  ) {}

  async send(
    account: WelcomeAccount,
    actorId: string,
  ): Promise<WelcomeEmailResult> {
    let result: WelcomeEmailResult;
    const authkey = this.config.get<string>('MSG91_AUTH_KEY');
    const domain = this.config.get<string>('MSG91_EMAIL_DOMAIN');
    const sender = this.config.get<string>('MSG91_EMAIL_FROM');
    const template = this.config.get<string>('MSG91_WELCOME_TEMPLATE_ID');
    const loginUrl = this.config.get<string>('CLIENT_LOGIN_URL');
    if (!account.email) {
      result = {
        status: 'missing_recipient',
        message: 'Welcome email was not sent: Account Admin email is missing.',
      };
    } else if (
      this.config.get('EMAIL_PROVIDER') !== 'msg91' ||
      !authkey ||
      !domain ||
      !sender ||
      !template ||
      !loginUrl
    ) {
      result = {
        status: 'not_configured',
        message: 'Welcome email was not sent: configure MSG91 email settings.',
      };
    } else {
      try {
        const response = await fetch(
          'https://control.msg91.com/api/v5/email/send',
          {
            method: 'POST',
            headers: {
              authkey,
              accept: 'application/json',
              'content-type': 'application/json',
            },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
              recipients: [
                {
                  to: [{ name: account.clientName, email: account.email }],
                  variables: {
                    client_name: account.clientName,
                    company_name: account.companyName,
                    company_code: account.companyCode,
                    registered_mobile_number: account.mobile,
                    login_url: loginUrl,
                  },
                },
              ],
              from: { name: 'Team EVs Eye', email: sender },
              domain,
              template_id: template,
            }),
          },
        );
        const payload = (await response.json()) as {
          status?: string;
          type?: string;
          hasError?: boolean;
        };
        if (
          !response.ok ||
          payload.status === 'fail' ||
          payload.status === 'error' ||
          payload.type === 'error' ||
          payload.hasError
        ) {
          throw new Error('Email provider rejected the request');
        }
        result = {
          status: 'accepted',
          message: 'Welcome email accepted by MSG91 for delivery.',
        };
      } catch {
        // Never roll back a created account or expose credentials/provider payloads on email failure.
        result = {
          status: 'failed',
          message:
            'Client account is ready, but the welcome email could not be sent. Check MSG91 before retrying delivery.',
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
