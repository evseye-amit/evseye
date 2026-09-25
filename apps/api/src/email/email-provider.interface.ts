export interface WelcomeEmailInput {
  recipientEmail: string;
  recipientName: string;
  companyName: string;
  companyCode: string;
  registeredMobileNumber: string;
  loginUrl: string;
}

export interface EmailProvider {
  isConfigured(): boolean;
  sendWelcome(input: WelcomeEmailInput): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
