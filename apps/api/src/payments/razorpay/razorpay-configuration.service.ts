import { createHash } from 'node:crypto';
import type { UpsertClientPaymentProviderDto } from '../../platform-admin/dto/client-payment-provider.dto.js';
import { ConflictException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';

export type RazorpayCredentials = {
  configurationVersionId?: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  merchantAccountId?: string | null;
  environment: string;
};

/** Resolves credentials for one client without exposing secrets to callers. */
@Injectable()
export class RazorpayConfigurationService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolve(clientId: string, environment?: string): Promise<RazorpayCredentials> {
    environment ??= this.config.get<string>('RAZORPAY_ENVIRONMENT')?.toUpperCase();
    const configured = await this.db.clientPaymentProvider.findFirst({
      where: { clientId, provider: 'RAZORPAY', ...(environment ? { environment } : {}) },
      orderBy: { validFrom: 'desc' },
    });
    if (configured) {
      if ((configured.status && configured.status !== 'ACTIVE') ||
          (configured.validFrom && configured.validFrom > new Date()) ||
          (configured.validUntil && configured.validUntil < new Date()))
        throw this.unavailable();
      const version = await this.db.paymentProviderConfigurationVersion.findUnique({
        where: { providerConfigurationId_version: { providerConfigurationId: configured.id, version: configured.currentVersion } },
      });
      if (!version || version.keyId !== configured.keyId || version.secretReference !== configured.secretReference || version.environment !== configured.environment || (version.merchantAccountId ?? null) !== (configured.merchantAccountId ?? null))
        throw this.unavailable();
      return this.resolveVersion(clientId, version.id);
    }

    const allowlist = (this.config.get<string>('RAZORPAY_CLIENT_IDS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (allowlist.includes(clientId)) {
      const keyId = this.config.get<string>('RAZORPAY_KEY_ID');
      const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
      const webhookSecret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET');
      if (keyId && keySecret && webhookSecret) return { keyId, keySecret, webhookSecret, environment: 'LEGACY' };
    }
    throw this.unavailable();
  }

  async resolveVersion(clientId: string, versionId: string): Promise<RazorpayCredentials> {
    const version = await this.db.paymentProviderConfigurationVersion.findFirst({ where: { id: versionId, clientId, provider: 'RAZORPAY' } });
    if (!version) throw this.unavailable();
    const secret = this.readSecretReference(version.secretReference);
    if (!secret) throw this.unavailable();
    const fingerprint = this.fingerprint(version.keyId, secret);
    if (!version.credentialFingerprint) {
      // Migration snapshots are sealed on first use with a compare-and-set.
      await this.db.paymentProviderConfigurationVersion.updateMany({ where: { id: version.id, credentialFingerprint: null }, data: { credentialFingerprint: fingerprint } });
      const sealed = await this.db.paymentProviderConfigurationVersion.findUniqueOrThrow({ where: { id: version.id } });
      if (sealed.credentialFingerprint !== fingerprint) throw this.unavailable();
    } else if (version.credentialFingerprint !== fingerprint) {
      throw new ServiceUnavailableException({ code: 'RAZORPAY_SECRET_VERSION_CHANGED', message: 'A retained merchant secret changed. Restore the versioned secret reference before retrying.' });
    }
    return { configurationVersionId: version.id, keyId: version.keyId, environment: version.environment, merchantAccountId: version.merchantAccountId, ...secret };
  }

  async webhookVersions(clientId: string) {
    const rows = await this.db.paymentProviderConfigurationVersion.findMany({ where: { clientId, provider: 'RAZORPAY', environment: this.config.get<string>('RAZORPAY_ENVIRONMENT') ?? 'TEST' }, orderBy: { createdAt: 'desc' }, take: 101 });
    if (rows.length > 100) throw this.unavailable();
    return rows.map(row => row.id);
  }

  async save(clientId: string, dto: UpsertClientPaymentProviderDto, actorId: string) {
    if (dto.provider !== 'RAZORPAY' || !/^env:[A-Z][A-Z0-9_]{2,127}$/.test(dto.secretReference) ||
        !new RegExp(dto.environment === 'TEST' ? '^rzp_test_[A-Za-z0-9]+$' : '^rzp_live_[A-Za-z0-9]+$').test(dto.keyId))
      throw new UnprocessableEntityException('Provide a Razorpay key matching the environment and a versioned env secret reference.');
    const secret = this.readSecretReference(dto.secretReference);
    if (!secret) throw this.unavailable();
    const fingerprint = this.fingerprint(dto.keyId, secret);
    return this.db.$transaction(async tx => {
      // Serialize updates for a tenant, including the first configuration insert.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
      if (!rows.length) throw this.unavailable();
      const previous = await tx.clientPaymentProvider.findUnique({ where: { clientId_provider_environment: { clientId, provider: dto.provider, environment: dto.environment } } });
      const previousVersion = previous ? await tx.paymentProviderConfigurationVersion.findUnique({ where: { providerConfigurationId_version: { providerConfigurationId: previous.id, version: previous.currentVersion } } }) : null;
      const changed = !previousVersion || previousVersion.keyId !== dto.keyId || previousVersion.secretReference !== dto.secretReference || previousVersion.merchantAccountId !== (dto.merchantAccountId ?? null);
      if (previousVersion && previousVersion.secretReference === dto.secretReference && (previousVersion.keyId !== dto.keyId || (previousVersion.credentialFingerprint && previousVersion.credentialFingerprint !== fingerprint)))
        throw new ConflictException('Credential rotation requires a new immutable secret reference; retain the previous reference.');
      const version = previous ? previous.currentVersion + (changed ? 1 : 0) : 1;
      const record = await tx.clientPaymentProvider.upsert({
        where: { clientId_provider_environment: { clientId, provider: dto.provider, environment: dto.environment } },
        create: { clientId, provider: dto.provider, environment: dto.environment, keyId: dto.keyId, secretReference: dto.secretReference, merchantAccountId: dto.merchantAccountId, status: dto.status ?? 'ACTIVE', currentVersion: version },
        update: { keyId: dto.keyId, secretReference: dto.secretReference, merchantAccountId: dto.merchantAccountId ?? null, status: dto.status ?? 'ACTIVE', currentVersion: version },
      });
      let snapshot = previousVersion;
      if (changed) snapshot = await tx.paymentProviderConfigurationVersion.create({ data: { clientId, providerConfigurationId: record.id, version, provider: dto.provider, environment: dto.environment, keyId: dto.keyId, secretReference: dto.secretReference, merchantAccountId: dto.merchantAccountId, credentialFingerprint: fingerprint } });
      else if (!previousVersion!.credentialFingerprint)
        await tx.paymentProviderConfigurationVersion.updateMany({ where: { id: previousVersion!.id, credentialFingerprint: null }, data: { credentialFingerprint: fingerprint } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'CLIENT_PAYMENT_PROVIDER_UPDATED', entityType: 'ClientPaymentProvider', entityId: record.id, newData: { provider: record.provider, environment: record.environment, keyId: record.keyId, status: record.status, configurationVersionId: snapshot!.id, version } } });
      const { secretReference: _secret, ...publicRecord } = record;
      return { ...publicRecord, configurationVersionId: snapshot!.id };
    });
  }

  private fingerprint(keyId: string, secret: { keySecret: string; webhookSecret: string }) {
    return createHash('sha256').update(JSON.stringify([keyId, secret.keySecret, secret.webhookSecret])).digest('hex');
  }

  private unavailable() {
    return new ServiceUnavailableException({ code: 'RAZORPAY_UNAVAILABLE', message: 'Online payment is unavailable for this workspace or merchant account.' });
  }

  private readSecretReference(reference: string): Pick<RazorpayCredentials, 'keySecret' | 'webhookSecret'> | null {
    if (!reference.startsWith('env:')) return null;
    try {
      const value = JSON.parse(this.config.get<string>(reference.slice(4)) ?? '{}') as { keySecret?: string; webhookSecret?: string };
      return typeof value.keySecret === 'string' && value.keySecret.length > 0 &&
        typeof value.webhookSecret === 'string' && value.webhookSecret.length > 0
        ? { keySecret: value.keySecret, webhookSecret: value.webhookSecret } : null;
    } catch { return null; }
  }
}
