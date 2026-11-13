import { Injectable } from '@nestjs/common';
export type RazorpayInboxEvent = {
  id: string;
  clientId?: string | null;
  configurationVersionId?: string | null;
  eventType: string;
  recurringPayload?: unknown;
  deploymentPayload: unknown;
};
@Injectable()
export class RazorpayEventRouter {
  private handler?: (event: RazorpayInboxEvent) => Promise<boolean>;
  register(handler: (event: RazorpayInboxEvent) => Promise<boolean>) {
    this.handler = handler;
  }
  async process(event: RazorpayInboxEvent) {
    return this.handler ? this.handler(event) : false;
  }
}
