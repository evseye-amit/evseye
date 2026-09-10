import { Injectable, Logger } from '@nestjs/common';
import type { SendSmsInput, SmsProvider } from './sms-provider.interface.js';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(input: SendSmsInput): Promise<void> {
    // Never log the message: it contains an OTP. This is a development-only
    // delivery adapter and is replaced by a provider adapter in deployment.
    this.logger.log({ phone: input.phone, purpose: input.purpose, event: 'sms_dispatched' });
  }
}
