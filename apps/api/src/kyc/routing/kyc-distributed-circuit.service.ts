import { Injectable } from '@nestjs/common';
import { KycVerificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Cron } from '@nestjs/schedule';
import { ProviderRegistryService } from '../verification/provider-registry.service.js';

@Injectable()
export class KycDistributedCircuitService {
  constructor(private readonly prisma: PrismaService, private readonly registry: ProviderRegistryService) {}

  async isOpen(providerId: string, verificationType: KycVerificationType): Promise<boolean> {
    const row = await this.prisma.kycProviderCircuitState.findUnique({
      where: { providerId_verificationType: { providerId, verificationType } },
    });
    if (!row || row.state === 'CLOSED') return false;
    // Expiry permits only an explicit health probe to close the circuit; it never sends live identity traffic.
    return true;
  }

  async record(providerId: string, verificationType: KycVerificationType, technicalFailure: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.kycProviderCircuitState.upsert({
        where: { providerId_verificationType: { providerId, verificationType } },
        create: { providerId, verificationType, state: 'CLOSED' }, update: {},
      });
      if (row.state !== 'CLOSED') return;
      const failures = technicalFailure ?
        (row.lastFailureAt && now.getTime() - row.lastFailureAt.getTime() <= 60_000 ? row.consecutiveFailures + 1 : 1) : 0;
      await tx.kycProviderCircuitState.update({ where: { id: row.id }, data: {
        consecutiveFailures: failures, lastFailureAt: technicalFailure ? now : null,
        ...(failures >= 3 ? { state: 'OPEN', openUntil: new Date(now.getTime() + 30_000), healthyProbes: 0 } : {}),
      } });
    });
  }

  @Cron('*/15 * * * * *')
  async probe(): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.kycProviderCircuitState.findMany({ where: {
      state: { in: ['OPEN', 'HALF_OPEN'] }, OR: [{ openUntil: { lte: now } }, { openUntil: null }],
    } });
    for (const row of rows) {
      if (row.lastProbeAt && now.getTime() - row.lastProbeAt.getTime() < 14_000) continue;
      const provider = await this.prisma.kycProviderConfig.findUnique({ where: { id: row.providerId }, select: { code: true } });
      if (!provider) continue;
      const healthy = await this.registry.health(provider.code) === 'AVAILABLE';
      await this.prisma.kycProviderCircuitState.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: healthy ? {
        state: row.healthyProbes + 1 >= 3 ? 'CLOSED' : 'HALF_OPEN', healthyProbes: row.healthyProbes + 1,
        consecutiveFailures: row.healthyProbes + 1 >= 3 ? 0 : row.consecutiveFailures,
        lastProbeAt: now, openUntil: null,
      } : { state: 'OPEN', healthyProbes: 0, lastProbeAt: now,
        openUntil: new Date(now.getTime() + 30_000) } });
    }
  }
}
