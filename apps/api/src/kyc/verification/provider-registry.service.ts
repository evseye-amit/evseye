import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { KycProviderCode, KycProviderEnvironment, KycVerificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SandboxVerificationProvider } from './sandbox-verification.provider.js';
import type { VerificationProvider } from './kyc-types.js';

@Injectable()
export class ProviderRegistryService {
  private readonly providers: Map<KycProviderCode, VerificationProvider>;

  constructor(private readonly prisma: PrismaService, sandbox: SandboxVerificationProvider,
    @Optional() private readonly settings?: ConfigService<Environment, true>) {
    this.providers = new Map([[sandbox.code, sandbox]]);
  }

  /** Additional adapters register through DI; production never registers test doubles. */
  register(provider: VerificationProvider) { this.providers.set(provider.code, provider); }
  circuitOpen(code: KycProviderCode) { return this.providers.get(code)?.circuitOpen?.() ?? false; }
  async health(code: KycProviderCode) { return this.providers.get(code)?.health() ?? 'UNAVAILABLE'; }

  private async credential(providerId: string, clientId: string, environment: KycProviderEnvironment, now: Date) {
    const base = {
      providerId, environment, status: 'ACTIVE',
      AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gt: now } }] }],
    };
    const orderBy = [{ validFrom: 'desc' as const }, { createdAt: 'desc' as const }];
    return await this.prisma.kycProviderCredential.findFirst({ where: { ...base, clientId }, orderBy }) ??
      this.prisma.kycProviderCredential.findFirst({ where: { ...base, clientId: null }, orderBy });
  }

  private environment(): KycProviderEnvironment {
    return this.settings?.get('KYC_ENVIRONMENT') ?? this.settings?.get('KYC_SANDBOX_ENVIRONMENT') ?? 'TEST';
  }

  async eligible(clientId: string, type: KycVerificationType, environment: KycProviderEnvironment = this.environment()) {
    const now = new Date();
    const candidates = await this.prisma.kycProviderConfig.findMany({
      where: { isActive: true, status: 'ACTIVE', environment,
        capabilities: { some: { verificationType: type, isSupported: true, isEnabled: true } } },
      include: { capabilities: { where: { verificationType: type } } }, orderBy: { priority: 'asc' },
    });
    const eligible = [];
    for (const config of candidates) {
      const provider = this.providers.get(config.code);
      if (!provider?.supports(type) || provider.circuitOpen?.()) continue;
      const capability = config.capabilities[0];
      if (!capability?.isSupported || !capability.isEnabled) continue;
      const credential = await this.credential(config.id, clientId, config.environment, now);
      if (!credential || !provider.acceptsCredential(config.environment, credential.secretReference)) continue;
      eligible.push({ config, capability, provider, secretReference: credential.secretReference });
    }
    return eligible;
  }

  async resolve(clientId: string, type: KycVerificationType) {
    const candidates = await this.eligible(clientId, type);
    if (!candidates.length) throw new ServiceUnavailableException('KYC_PROVIDER_UNAVAILABLE');
    return candidates[0];
  }

  async pinned(clientId: string, type: KycVerificationType, providerId: string) {
    const config = await this.prisma.kycProviderConfig.findUnique({ where: { id: providerId },
      include: { capabilities: { where: { verificationType: type } } } });
    if (!config || !config.isActive || config.status !== 'ACTIVE' || config.environment !== this.environment()) throw new ServiceUnavailableException('KYC_PROVIDER_UNAVAILABLE');
    const provider = this.providers.get(config.code);
    const capability = config.capabilities[0];
    if (!provider?.supports(type) || !capability?.isSupported || !capability.isEnabled)
      throw new ServiceUnavailableException('KYC_PROVIDER_UNAVAILABLE');
    const now = new Date();
    const credential = await this.credential(providerId, clientId, config.environment, now);
    if (!credential || !provider.acceptsCredential(config.environment, credential.secretReference)) throw new ServiceUnavailableException('KYC_PROVIDER_UNAVAILABLE');
    return { config, capability, provider, secretReference: credential.secretReference };
  }
}
