export interface SendSmsInput {
  phone: string;
  code: string;
  purpose: string;
}

export interface SmsProvider {
  send(input: SendSmsInput): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
