import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('client/autopay')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class AutoPayOperationsController {
  constructor(private readonly prisma: PrismaService, private readonly clients: ClientContextService) {}

  @Get('riders/:riderId')
  async rider(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) {
    const clientId = this.clients.requireClientId(user);
    const [profile, mandate, dunning] = await Promise.all([
      this.prisma.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId } } }),
      this.prisma.paymentMandate.findFirst({ where: { clientId, riderId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.autoPayDunningCase.findMany({ where: { clientId, riderId, status: { not: 'RESOLVED' } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    ]);
    return { data: { enabled: profile?.autoPayEnabled ?? false, mandate: mandate && {
      id: mandate.id, mandateNumber: mandate.mandateNumber, method: mandate.method,
      status: mandate.status, autoDebitEnabled: mandate.autoDebitEnabled,
      maxAmount: mandate.maxAmount.toFixed(2), expiresAt: mandate.expiresAt,
    }, dunning } };
  }

  @Get('mandates')
  async mandates(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const items = await this.prisma.paymentMandate.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: items.map(item => ({ id: item.id, mandateNumber: item.mandateNumber, riderId: item.riderId,
      method: item.method, status: item.status, autoDebitEnabled: item.autoDebitEnabled, expiresAt: item.expiresAt })) };
  }

  @Get('debits')
  async debits(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const items = await this.prisma.paymentTransaction.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: items.map(item => ({ id: item.id, debitNumber: item.debitNumber, invoiceId: item.invoiceId,
      riderId: item.riderId, amount: item.amount.toFixed(2), status: item.status,
      scheduledAt: item.scheduledAt, failureCode: item.failureCode })) };
  }

  @Get('dunning')
  async dunning(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    return { data: await this.prisma.autoPayDunningCase.findMany({ where: { clientId, status: { not: 'RESOLVED' } }, orderBy: { updatedAt: 'desc' }, take: 100 }) };
  }
}
