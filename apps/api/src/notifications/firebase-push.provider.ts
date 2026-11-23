import { topicName } from './notification-topic.helpers.js';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { cert, getApp, initializeApp } from 'firebase-admin/app';
import { parseFirebaseServiceAccount } from '../config/firebase-credentials.js';
import { getMessaging, type Message } from 'firebase-admin/messaging';

export type PushTarget = {
  bindingId?: string | null;
  appCode?: string;
  platform?: string;
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
  deferred?: boolean;
  accepted: boolean;
  messageId?: string;
  code?: string;
  retryable?: boolean;
  invalidToken?: boolean;
  retryAfterSeconds?: number;
};
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
export type PushScope = { id: string; configurationId?: string };
export type TopicTarget = {
  bindingId: string;
  clientId: string;
  token: string;
  logicalKey: string;
  name: string;
  subscribe: boolean;
};
export interface PushProvider {
  manageTopic?(target: TopicTarget): Promise<PushResult>;

  scopes?(): Promise<PushScope[]>;
  clientConfigured?(clientId: string): Promise<boolean>;
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
  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
  ) {}
  // Availability is unconditional. Readiness is evaluated per client/project.
  readonly configured = true;
  get environment() {
    return this.config.get<string>('PUSH_ENVIRONMENT') ?? 'development';
  }
  async scopes(): Promise<PushScope[]> {
    const configurations = await this.db.firebaseProjectConfiguration.findMany({
      where: { environment: this.environment, isActive: true },
      select: { id: true },
    });
    return configurations.map((row) => ({
      id: `firebase:${this.environment}:${row.id}`,
      configurationId: row.id,
    }));
  }
  private credential(reference: string, projectId: string) {
    if (!/^[A-Z][A-Z0-9_]{0,149}$/.test(reference))
      throw new Error('Invalid credential reference');
    const raw = this.config.get<string>(reference);
    if (!raw) throw new Error('Missing credential');
    return { raw, account: parseFirebaseServiceAccount(raw, projectId) };
  }
  async clientConfigured(clientId: string) {
    const bindings = await this.db.notificationAppBinding.findMany({
      where: {
        clientId,
        isActive: true,
        environment: this.environment,
        firebaseConfiguration: { isActive: true },
      },
      include: { firebaseConfiguration: true },
    });
    if (!bindings.length) return false;
    return bindings.every(({ firebaseConfiguration: c }) => {
      try {
        this.credential(c.credentialReference, c.projectId);
        return true;
      } catch {
        return false;
      }
    });
  }
  private firebaseApp(c: {
    id: string;
    projectId: string;
    credentialReference: string;
    credentialVersion: number;
  }) {
    const { raw, account } = this.credential(
      c.credentialReference,
      c.projectId,
    );
    const fingerprint = createHash('sha256')
      .update(raw)
      .digest('hex')
      .slice(0, 16);
    const name = `evseye-push-${c.id}-${c.credentialVersion}-${fingerprint}`;
    try {
      return getApp(name);
    } catch {
      return initializeApp(
        { projectId: c.projectId, credential: cert(account) },
        name,
      );
    }
  }
  async manageTopic(target: TopicTarget): Promise<PushResult> {
    // Disabled bindings/projects must still permit cleanup under their original credentials.
    const bindings = await this.db.notificationAppBinding.findMany({
      where: {
        id: target.bindingId,
        clientId: target.clientId,
        environment: this.environment,
        ...(target.subscribe
          ? { isActive: true, firebaseConfiguration: { isActive: true } }
          : {}),
      },
      include: { firebaseConfiguration: true },
    });
    const binding = bindings.find(
      (b) => b.id === target.bindingId && b.clientId === target.clientId,
    );
    if (
      !binding ||
      target.name !==
        topicName(
          this.environment,
          target.clientId,
          target.bindingId,
          binding.appCode,
          target.logicalKey,
        )
    )
      return {
        accepted: false,
        deferred: true,
        code: 'TOPIC_CONFIGURATION_UNAVAILABLE',
      };
    let app;
    try {
      app = this.firebaseApp(binding.firebaseConfiguration);
    } catch {
      return {
        accepted: false,
        deferred: true,
        code: 'PUSH_CONFIGURATION_UNAVAILABLE',
      };
    }
    try {
      const messaging = getMessaging(app);
      const result = target.subscribe
        ? await messaging.subscribeToTopic([target.token], target.name)
        : await messaging.unsubscribeFromTopic([target.token], target.name);
      return result.successCount === 1
        ? { accepted: true }
        : classifyPushError(result.errors[0]?.error);
    } catch (cause) {
      return classifyPushError(cause);
    }
  }
  async send(targets: PushTarget[]): Promise<PushResult[]> {
    const results: PushResult[] = targets.map(() => ({
      accepted: false,
      deferred: true,
      code: 'PUSH_CONFIGURATION_UNAVAILABLE',
    }));
    const bindings = await this.db.notificationAppBinding.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              targets.flatMap((t) => (t.bindingId ? [t.bindingId] : [])),
            ),
          ],
        },
        environment: this.environment,
        isActive: true,
        firebaseConfiguration: { isActive: true },
      },
      include: { firebaseConfiguration: true },
    });
    const byId = new Map(bindings.map((b) => [b.id, b]));
    const groups = new Map<
      string,
      { binding: (typeof bindings)[number]; indexes: number[] }
    >();
    targets.forEach((target, index) => {
      const binding = target.bindingId ? byId.get(target.bindingId) : undefined;
      if (
        !binding ||
        binding.clientId !== target.clientId ||
        binding.appCode !== target.appCode ||
        binding.platform !== target.platform
      )
        return;
      const group = groups.get(binding.firebaseConfigurationId) ?? {
        binding,
        indexes: [],
      };
      group.indexes.push(index);
      groups.set(binding.firebaseConfigurationId, group);
    });
    await Promise.all(
      [...groups.values()].map(async ({ binding, indexes }) => {
        const c = binding.firebaseConfiguration;
        let app;
        try {
          app = this.firebaseApp(c);
        } catch {
          return;
        } // No raw secret/parser errors are returned or logged.
        for (let start = 0; start < indexes.length; start += 500) {
          const batch = indexes.slice(start, start + 500);
          const messages: Message[] = batch.map((index) => {
            const target = targets[index]!;
            return {
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
            };
          });
          try {
            const response = await getMessaging(app).sendEach(messages);
            batch.forEach((index, offset) => {
              const result = response.responses[offset];
              results[index] = result?.success
                ? { accepted: true, messageId: result.messageId }
                : classifyPushError(result?.error);
            });
          } catch (cause) {
            batch.forEach((index) => {
              results[index] = classifyPushError(cause);
            });
          }
        }
      }),
    );
    return results;
  }
}
