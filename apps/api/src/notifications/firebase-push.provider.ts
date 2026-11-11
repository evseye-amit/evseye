import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';

export type PushTarget = {
  token: string;
  notificationId: string;
  messageId: string;
  userId: string;
  clientId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  expiresAt: Date;
};
export type PushResult = {
  accepted: boolean;
  messageId?: string;
  code?: string;
  retryable?: boolean;
  invalidToken?: boolean;
  retryAfterSeconds?: number;
};
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
export interface PushProvider {
  readonly configured: boolean;
  send(targets: PushTarget[]): Promise<PushResult[]>;
}
export function classifyPushError(cause: unknown): PushResult {
  const error = cause as {
    code?: string;
    httpResponse?: { headers?: Record<string, string> };
  };
  const code =
    typeof error?.code === 'string' ? error.code : 'messaging/unknown-error';
  const invalidToken = [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ].includes(code);
  const retryable = [
    'messaging/server-unavailable',
    'messaging/internal-error',
    'messaging/unknown-error',
    'messaging/quota-exceeded',
    'messaging/message-rate-exceeded',
    'messaging/device-message-rate-exceeded',
    'app/network-error',
    'app/network-timeout',
  ].includes(code);
  const retryHeader = error?.httpResponse?.headers?.['retry-after'];
  const retrySeconds = retryHeader
    ? Number.isFinite(Number(retryHeader))
      ? Number(retryHeader)
      : Math.max(0, (Date.parse(retryHeader) - Date.now()) / 1000)
    : 0;
  return {
    accepted: false,
    code,
    invalidToken,
    retryable,
    retryAfterSeconds: Math.max(
      Number.isFinite(retrySeconds) ? retrySeconds : 0,
      code.includes('quota') || code.includes('rate-exceeded') ? 60 : 0,
    ),
  };
}
@Injectable()
export class FirebasePushProvider implements PushProvider {
  constructor(private readonly config: ConfigService) {}
  get configured() {
    return (
      this.config.get('PUSH_ENABLED') === true &&
      Boolean(this.config.get('FIREBASE_PROJECT_ID'))
    );
  }
  async send(targets: PushTarget[]): Promise<PushResult[]> {
    if (!this.configured)
      throw new Error('Push notifications are not configured.');
    try {
      const projectId = this.config.getOrThrow<string>('FIREBASE_PROJECT_ID');
      const name = `evseye-push-${projectId}`;
      let app;
      try {
        app = getApp(name);
      } catch {
        app = initializeApp(
          { projectId, credential: applicationDefault() },
          name,
        );
      }
      const messages: Message[] = targets.map((target) => ({
        token: target.token,
        notification: { title: target.title, body: target.body },
        data: {
          ...target.data,
          notificationId: target.notificationId,
          messageId: target.messageId,
          userId: target.userId,
          clientId: target.clientId,
        },
        android: {
          ttl: Math.max(0, target.expiresAt.getTime() - Date.now()),
          notification: { tag: target.notificationId },
        },
        apns: {
          headers: {
            'apns-expiration': String(
              Math.floor(target.expiresAt.getTime() / 1000),
            ),
            'apns-collapse-id': target.notificationId,
          },
        },
      }));
      const result = await getMessaging(app).sendEach(messages);
      return result.responses.map((response) =>
        response.success
          ? { accepted: true, messageId: response.messageId }
          : classifyPushError(response.error),
      );
    } catch (cause) {
      return targets.map(() => classifyPushError(cause));
    }
  }
}
