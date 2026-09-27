import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../../auth/client-context.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProviderRegistryService } from './provider-registry.service.js';

@Controller('kyc/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class VerificationAdminController {
  constructor(private readonly prisma: PrismaService, private readonly clients: ClientContextService,
    private readonly registry: ProviderRegistryService) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const groups = await this.prisma.kycVerification.groupBy({ by: ['status'], where: { clientId }, _count: { _all: true } });
    return { data: { total: groups.reduce((sum, group) => sum + group._count._all, 0),
      byStatus: Object.fromEntries(groups.map((group) => [group.status, group._count._all])) } };
  }

  @Get('providers')
  async providers(@CurrentUser() user: AuthUser) {
    this.clients.requireClientId(user);
    const data = await this.prisma.kycProviderConfig.findMany({
      select: { id: true, code: true, name: true, status: true, environment: true, priority: true,
        isActive: true, capabilities: { select: { verificationType: true, isSupported: true,
          isEnabled: true, timeoutMs: true, maxRetries: true } } },
      orderBy: { priority: 'asc' },
    });
    return { data };
  }

  @Get('providers/:id/health')
  async health(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const clientId = this.clients.requireClientId(user);
    const provider = await this.prisma.kycProviderConfig.findUnique({ where: { id }, select: { id: true, code: true, isActive: true } });
    if (!provider) throw new NotFoundException('KYC_PROVIDER_NOT_FOUND');
    const attempts = await this.prisma.kycVerificationAttempt.findMany({
      where: { providerId: id, verification: { clientId }, responseReceivedAt: { not: null } },
      select: { normalizedStatus: true, latencyMs: true, responseReceivedAt: true },
      orderBy: { responseReceivedAt: 'desc' }, take: 100,
    });
    const successes = attempts.filter((attempt) => attempt.normalizedStatus === 'VERIFIED');
    const failures = attempts.filter((attempt) => attempt.normalizedStatus === 'FAILED');
    const latencies = attempts.flatMap((attempt) => attempt.latencyMs == null ? [] : [attempt.latencyMs]);
    return { data: { providerId: id,
      status: provider.isActive ? await this.registry.health(provider.code) : 'UNAVAILABLE',
      recentRequests: attempts.length,
      successRate: attempts.length ? successes.length / attempts.length : null,
      failureRate: attempts.length ? failures.length / attempts.length : null,
      averageLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      lastSuccessAt: successes[0]?.responseReceivedAt ?? null,
      lastFailureAt: failures[0]?.responseReceivedAt ?? null,
    } };
  }
}
