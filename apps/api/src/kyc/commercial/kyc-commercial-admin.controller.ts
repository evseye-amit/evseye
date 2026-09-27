import { BadRequestException, Body, Controller, Get, Param, ParseEnumPipe, Put, Query, UseGuards } from '@nestjs/common';
import { KycVerificationType, UserRole } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { ClientContextService } from '../../auth/client-context.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycCommercialService } from './kyc-commercial.service.js';

type PolicyInput = { isEnabled?: boolean; workflowDefinitionId?: string | null; routingPolicyId?: string | null;
  validityDays?: number | null; reverificationRequired?: boolean; overagePolicy?: 'BLOCK' | 'ALLOW_AND_CHARGE' | 'ALLOW_WITH_WARNING' };

@Controller('kyc/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class KycCommercialAdminController {
  constructor(private readonly prisma: PrismaService, private readonly clients: ClientContextService,
    private readonly commercial: KycCommercialService, private readonly audit: AuditService) {}

  @Get('client-policies')
  async policies(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    return { data: await this.prisma.kycClientPolicy.findMany({ where: { clientId },
      orderBy: [{ verificationType: 'asc' }, { effectiveFrom: 'desc' }] }) };
  }

  @Put('client-policies/:type')
  @Roles(UserRole.CLIENT_ADMIN)
  async setPolicy(@CurrentUser() user: AuthUser, @Param('type', new ParseEnumPipe(KycVerificationType)) type: KycVerificationType,
    @Body() body: PolicyInput) {
    const clientId = this.clients.requireClientId(user);
    if (body.validityDays != null && (!Number.isInteger(body.validityDays) || body.validityDays < 1 || body.validityDays > 3650))
      throw new BadRequestException('KYC_INVALID_POLICY');
    if (body.overagePolicy && !['BLOCK', 'ALLOW_AND_CHARGE', 'ALLOW_WITH_WARNING'].includes(body.overagePolicy))
      throw new BadRequestException('KYC_INVALID_POLICY');
    if (body.routingPolicyId) {
      const route = await this.prisma.kycRoutingPolicy.findFirst({ where: { id: body.routingPolicyId,
        verificationType: type, status: 'ACTIVE', OR: [{ clientId }, { clientId: null }] }, select: { id: true } });
      if (!route) throw new BadRequestException('KYC_INVALID_ROUTING_POLICY');
    }
    if (body.workflowDefinitionId) {
      const workflow = await this.prisma.kycWorkflowDefinition.findFirst({ where: { id: body.workflowDefinitionId,
        status: 'ACTIVE', OR: [{ clientId }, { clientId: null }], steps: { some: { verificationType: type } } },
      select: { id: true } });
      if (!workflow) throw new BadRequestException('KYC_INVALID_WORKFLOW_DEFINITION');
    }
    const current = await this.prisma.kycClientPolicy.findFirst({ where: { clientId, verificationType: type, status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' } });
    const data = { isEnabled: body.isEnabled ?? current?.isEnabled ?? true,
      workflowDefinitionId: body.workflowDefinitionId === undefined ? current?.workflowDefinitionId : body.workflowDefinitionId,
      routingPolicyId: body.routingPolicyId === undefined ? current?.routingPolicyId : body.routingPolicyId,
      validityDays: body.validityDays === undefined ? current?.validityDays : body.validityDays,
      reverificationRequired: body.reverificationRequired ?? current?.reverificationRequired ?? false,
      overagePolicy: body.overagePolicy ?? current?.overagePolicy ?? 'BLOCK' };
    const saved = current ? await this.prisma.kycClientPolicy.update({ where: { id: current.id }, data }) :
      await this.prisma.kycClientPolicy.create({ data: { clientId, verificationType: type, ...data } });
    await this.audit.record({ clientId, actorId: user.id, action: current ? 'KYC_CLIENT_POLICY_UPDATED' : 'KYC_CLIENT_POLICY_CREATED',
      entityType: 'KYC_CLIENT_POLICY', entityId: saved.id, newData: { verificationType: type,
        isEnabled: saved.isEnabled, routingPolicyId: saved.routingPolicyId, workflowDefinitionId: saved.workflowDefinitionId,
        overagePolicy: saved.overagePolicy } });
    return { data: saved };
  }

  @Get('entitlements')
  async entitlements(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const data = await Promise.all(Object.values(KycVerificationType).map(async (type) => {
      try {
        const value = await this.commercial.entitlement(clientId, type);
        return { verificationType: type, enabled: true, featureCode: value.feature?.code ?? null,
          packageId: value.subscription?.packageId ?? null, unlimited: value.clientFeature?.unlimitedUsage ?? false,
          policyId: value.policy?.id ?? null };
      } catch (cause) {
        if (!(cause instanceof BadRequestException)) throw cause;
        return { verificationType: type, enabled: false, featureCode: null, packageId: null,
          unlimited: false, policyId: null };
      }
    }));
    return { data };
  }

  @Get('usage')
  async usage(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const [consumptions, balances] = await Promise.all([
      this.prisma.featureUsageConsumption.groupBy({ by: ['featureId', 'source'], where: { clientId, reversedAt: null },
        _count: { _all: true } }),
      this.prisma.featureCreditLot.findMany({ where: { clientId, quantityAvailable: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { featureId: true, quantityAvailable: true, feature: { select: { code: true, name: true } } } }),
    ]);
    return { data: { consumptions, balances } };
  }

  @Get('add-ons')
  async addOns(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const subscription = await this.prisma.clientSubscription.findFirst({ where: { clientId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' }, select: { id: true, packageId: true } });
    if (!subscription) return { data: { available: [], purchased: [] } };
    const codes = ['PAN_VERIFICATION', 'AADHAAR_VERIFICATION', 'BANK_VERIFICATION', 'IFSC_VERIFICATION'];
    const [available, purchased] = await Promise.all([
      this.prisma.packageFeatureAddOn.findMany({ where: { packageId: subscription.packageId, isAvailable: true,
        featureAddOn: { isActive: true, feature: { code: { in: codes } } } },
      select: { featureAddOn: { select: { id: true, code: true, name: true, quantity: true, salePrice: true,
        currency: true, validityDays: true, feature: { select: { code: true } } } } } }),
      this.prisma.clientFeatureAddOnPurchase.findMany({ where: { clientId },
        select: { id: true, status: true, quantityPurchased: true, quantityConsumed: true,
          quantityRemaining: true, purchasedAt: true, expiresAt: true,
          featureAddOn: { select: { code: true, name: true } } },
      orderBy: { purchasedAt: 'desc' }, take: 50 }),
    ]);
    return { data: { available: available.map((item) => item.featureAddOn), purchased } };
  }

  @Get('usage/ledger')
  async ledger(@CurrentUser() user: AuthUser, @Query('skip') skip = '0') {
    const clientId = this.clients.requireClientId(user);
    const offset = Number(skip);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new BadRequestException('KYC_INVALID_PAGE');
    return { data: await this.prisma.featureUsageConsumption.findMany({ where: { clientId },
      select: { id: true, verificationId: true, source: true, quantity: true, occurredAt: true,
        reversedAt: true, basePrice: true, discount: true, effectivePrice: true, currency: true,
        feature: { select: { code: true, name: true } } },
      orderBy: { occurredAt: 'desc' }, skip: offset, take: 50 }) };
  }
}
