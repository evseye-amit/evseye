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
  private handlers: Array<(event: RazorpayInboxEvent) => Promise<boolean>> = [];
  register(handler: (event: RazorpayInboxEvent) => Promise<boolean>) {
    this.handlers.push(handler);
  }
  async process(event: RazorpayInboxEvent) {
    for (const handler of this.handlers) if (await handler(event)) return true;
    return false;
  }
}
