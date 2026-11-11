import { Injectable } from '@nestjs/common';
import type { EmailProvider, WelcomeEmailInput } from './email-provider.interface.js';

@Injectable()
export class DisabledEmailProvider implements EmailProvider {
  isConfigured(): boolean { return false; }
  async sendWelcome(_input: WelcomeEmailInput): Promise<void> { return; }
}
