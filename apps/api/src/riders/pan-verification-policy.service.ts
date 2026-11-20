import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Environment } from '../config/environment.js';

/** Configuration decides the mode; runtime provider health must never enable a bypass. */
@Injectable()
export class PanVerificationPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService<Environment, true>) {}

  async automated(clientId: string): Promise<boolean> {
    if (!this.config.get('KYC_ENABLED')) return false;
    const now = new Date();
    const policy = await this.prisma.kycClientPolicy.findFirst({
      where: { clientId, verificationType: 'PAN_VERIFICATION', status: 'ACTIVE',
        effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: { isEnabled: true },
    });
    if (policy?.isEnabled === false) return false;
    const feature = await this.prisma.clientFeature.findFirst({
      where: { clientId, enabled: true, feature: { code: 'VERIFY_PAN', isActive: true } },
      select: { id: true },
    });
    if (!feature) return false;
    const provider = await this.prisma.kycProviderConfig.findFirst({
      where: { isActive: true, status: 'ACTIVE',
        environment: this.config.get('KYC_ENVIRONMENT') ?? this.config.get('KYC_SANDBOX_ENVIRONMENT') ?? 'TEST',
        capabilities: { some: { verificationType: 'PAN_VERIFICATION', isSupported: true, isEnabled: true } } },
      select: { id: true },
    });
    // Credentials/health are deliberately excluded: an enabled but broken provider must fail closed.
    return !!provider;
  }
}
