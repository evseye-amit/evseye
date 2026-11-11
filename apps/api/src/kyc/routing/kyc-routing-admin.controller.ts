import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../../auth/client-context.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycProviderHealthService } from './kyc-provider-health.service.js';

@Controller('kyc/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class KycRoutingAdminController {
  constructor(private readonly prisma: PrismaService, private readonly clients: ClientContextService,
    private readonly health: KycProviderHealthService) {}

  @Get('routing-policies')
  async policies(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    return { data: await this.prisma.kycRoutingPolicy.findMany({ where: { OR: [{ clientId }, { clientId: null }] },
      select: { id: true, code: true, name: true, verificationType: true, strategy: true, version: true,
        clientId: true, status: true, isDefault: true, updatedAt: true }, orderBy: [{ code: 'asc' }, { version: 'desc' }] }) };
  }

  @Get('routing-policies/:id')
  async policy(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const clientId = this.clients.requireClientId(user);
    const policy = await this.prisma.kycRoutingPolicy.findFirst({ where: { id, OR: [{ clientId }, { clientId: null }] },
      select: { id: true, code: true, name: true, description: true, clientId: true, verificationType: true,
        strategy: true, status: true, version: true, isDefault: true, maxProvidersPerVerification: true,
        maxAttempts: true, allowParallel: true, allowHedging: true, arbitrationMode: true, fallbackCategories: true,
        providers: { select: { id: true, priority: true, weight: true, hedgeDelayMs: true, timeoutMs: true,
          maxAttempts: true, isEnabled: true, provider: { select: { id: true, code: true, name: true } } },
          orderBy: { priority: 'asc' } } } });
    if (!policy) throw new NotFoundException('KYC_ROUTING_POLICY_NOT_FOUND');
    return { data: policy };
  }

  @Get('provider-capability-health')
  async capabilityHealth(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const configs = await this.prisma.kycProviderConfig.findMany({ where: { isActive: true }, select: {
      id: true, code: true, name: true, capabilities: { where: { isSupported: true, isEnabled: true },
        select: { verificationType: true } } } });
    const data = await Promise.all(configs.flatMap((config) => config.capabilities.map(async (capability) => ({
      provider: { id: config.id, code: config.code, name: config.name },
      ...(await this.health.snapshot(config.id, config.code, capability.verificationType, clientId)),
    }))));
    return { data };
  }

  @Get('routing-trace/:verificationId')
  async trace(@CurrentUser() user: AuthUser, @Param('verificationId', ParseUUIDPipe) verificationId: string) {
    const clientId = this.clients.requireClientId(user);
    const verification = await this.prisma.kycVerification.findFirst({ where: { id: verificationId, clientId }, select: {
      id: true, verificationType: true, status: true, finalAttemptId: true,
      routingDecision: { select: { routingPolicyVersion: true, strategy: true, decisionReason: true,
        selectedProviders: true, routingPolicy: { select: { code: true } } } },
      attempts: { select: { id: true, attemptNumber: true, reason: true, status: true, failureCategory: true,
        failureType: true, latencyMs: true, requestStartedAt: true, responseReceivedAt: true,
        isLateCompletion: true,
        provider: { select: { code: true, name: true } } }, orderBy: { attemptNumber: 'asc' } },
      providerConflicts: { select: { provider: { select: { code: true } }, resultStatus: true,
        conflictType: true, resolution: true, createdAt: true } },
    } });
    if (!verification) throw new NotFoundException('KYC_VERIFICATION_NOT_FOUND');
    const events = await this.prisma.auditLog.findMany({ where: { clientId, entityType: 'KYC_VERIFICATION', entityId: verificationId,
      action: { startsWith: 'KYC_' } }, select: { id: true, action: true, createdAt: true, newData: true },
      orderBy: { createdAt: 'asc' }, take: 100 });
    return { data: { ...verification, events } };
  }
}
