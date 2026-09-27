import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { FinalSettlementService } from './final-settlement.service.js';

@Controller('client/agreements/:agreementId')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class AgreementSettlementController {
  constructor(
    private readonly context: ClientContextService,
    private readonly service: FinalSettlementService,
  ) {}
  @Get('settlement/preview') preview(
    @CurrentUser() u: AuthUser,
    @Param('agreementId') id: string,
  ) {
    return this.service
      .preview(this.context.requireClientId(u), id)
      .then((data) => ({ data }));
  }
  @Post('termination') termination(
    @CurrentUser() u: AuthUser,
    @Param('agreementId') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      requestedTerminationDate: string;
      reasonCode: string;
      reasonText?: string;
    },
  ) {
    return this.service
      .termination(this.context.requireClientId(u), id, u.id, key, body)
      .then((data) => ({ data }));
  }
  @Post('return') recordReturn(
    @CurrentUser() u: AuthUser,
    @Param('agreementId') id: string,
  ) {
    return this.service
      .recordReturn(this.context.requireClientId(u), id, u.id)
      .then((data) => ({ data }));
  }
  @Post('settlement') create(
    @CurrentUser() u: AuthUser,
    @Param('agreementId') id: string,
  ) {
    return this.service
      .create(this.context.requireClientId(u), id, u.id)
      .then((data) => ({ data }));
  }
}

@Controller('client/settlements')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class FinalSettlementController {
  constructor(
    private readonly context: ClientContextService,
    private readonly service: FinalSettlementService,
  ) {}
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service
      .get(this.context.requireClientId(u), id)
      .then((data) => ({ data }));
  }
  @Get(':id/reconciliation') @Roles(UserRole.CLIENT_ADMIN) reconcile(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service
      .reconcile(this.context.requireClientId(u), id)
      .then((data) => ({ data }));
  }
  @Post(':id/charges') assess(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      chargeType: string;
      description: string;
      amount: string;
      sourceType?: string;
      sourceId?: string;
      evidence?: unknown;
    },
  ) {
    return this.service
      .assess(this.context.requireClientId(u), id, u.id, body)
      .then((data) => ({ data }));
  }
  @Post(':id/charges/:chargeId/approve')
  @Roles(UserRole.CLIENT_ADMIN)
  approveCharge(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
    @Body() body: { amount?: string },
  ) {
    return this.service
      .decideCharge(
        this.context.requireClientId(u),
        id,
        chargeId,
        u.id,
        true,
        body?.amount,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/charges/:chargeId/reject')
  @Roles(UserRole.CLIENT_ADMIN)
  rejectCharge(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
  ) {
    return this.service
      .decideCharge(this.context.requireClientId(u), id, chargeId, u.id, false)
      .then((data) => ({ data }));
  }
  @Post(':id/notes') @Roles(UserRole.CLIENT_ADMIN) note(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      kind: 'CREDIT' | 'DEBIT';
      reasonCode: string;
      description: string;
      amount: string;
      invoiceId?: string;
    },
  ) {
    return this.service
      .issueNote(this.context.requireClientId(u), id, u.id, key, body)
      .then((data) => ({ data }));
  }
  @Post(':id/adjustments') adjustment(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: { type: 'CREDIT' | 'DEBIT'; amount: string; reason: string },
  ) {
    return this.service
      .adjustment(this.context.requireClientId(u), id, u.id, body)
      .then((data) => ({ data }));
  }
  @Post(':id/adjustments/:adjustmentId/approve')
  @Roles(UserRole.CLIENT_ADMIN)
  approveAdjustment(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
  ) {
    return this.service
      .decideAdjustment(
        this.context.requireClientId(u),
        id,
        adjustmentId,
        u.id,
        true,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/adjustments/:adjustmentId/reject')
  @Roles(UserRole.CLIENT_ADMIN)
  rejectAdjustment(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
  ) {
    return this.service
      .decideAdjustment(
        this.context.requireClientId(u),
        id,
        adjustmentId,
        u.id,
        false,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/submit-review') submitReview(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service
      .submitReview(this.context.requireClientId(u), id, u.id)
      .then((data) => ({ data }));
  }
  @Post(':id/request-approval') @Roles(UserRole.CLIENT_ADMIN) requestApproval(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service
      .requestApproval(this.context.requireClientId(u), id, u.id)
      .then((data) => ({ data }));
  }
  @Post(':id/approve') @Roles(UserRole.CLIENT_ADMIN) approve(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service
      .approve(this.context.requireClientId(u), id, u.id)
      .then((data) => ({ data }));
  }
  @Post(':id/deposits/:depositId/apply') @Roles(UserRole.CLIENT_ADMIN) apply(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('depositId') depositId: string,
    @Body() body: { amount: string; reason: string },
  ) {
    return this.service
      .applyDeposit(
        this.context.requireClientId(u),
        id,
        depositId,
        u.id,
        body.amount,
        body.reason,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/deposits/:depositId/holds') @Roles(UserRole.CLIENT_ADMIN) hold(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('depositId') depositId: string,
    @Body() body: { amount: string; reason: string; holdUntil?: string },
  ) {
    return this.service
      .hold(
        this.context.requireClientId(u),
        id,
        depositId,
        u.id,
        body.amount,
        body.reason,
        body.holdUntil,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/holds/:holdId/release') @Roles(UserRole.CLIENT_ADMIN) release(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('holdId') holdId: string,
  ) {
    return this.service
      .releaseHold(this.context.requireClientId(u), id, holdId, u.id)
      .then((data) => ({ data }));
  }
  @Post(':id/deposits/:depositId/refund') @Roles(UserRole.CLIENT_ADMIN) refund(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('depositId') depositId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { destinationType: string },
  ) {
    return this.service
      .requestRefund(
        this.context.requireClientId(u),
        id,
        depositId,
        u.id,
        key,
        body.destinationType,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/refunds/:refundId/complete')
  @Roles(UserRole.CLIENT_ADMIN)
  completeRefund(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('refundId') refundId: string,
    @Body() body: { externalReference: string },
  ) {
    return this.service
      .completeRefund(
        this.context.requireClientId(u),
        id,
        refundId,
        u.id,
        body.externalReference,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/refunds/:refundId/fail') @Roles(UserRole.CLIENT_ADMIN) failRefund(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('refundId') refundId: string,
    @Body() body: { reason: string },
  ) {
    return this.service
      .failDepositRefund(
        this.context.requireClientId(u),
        id,
        refundId,
        u.id,
        body.reason,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/payments/:paymentId/refund')
  @Roles(UserRole.CLIENT_ADMIN)
  excessRefund(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service
      .requestExcessPaymentRefund(
        this.context.requireClientId(u),
        id,
        paymentId,
        u.id,
        key,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/payments/:paymentId/manual-refund')
  @Roles(UserRole.CLIENT_ADMIN)
  manualExcessRefund(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { amount: string },
  ) {
    return this.service
      .requestManualExcessRefund(
        this.context.requireClientId(u),
        id,
        paymentId,
        u.id,
        key,
        body.amount,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/refunds/:refundId/complete-manual')
  @Roles(UserRole.CLIENT_ADMIN)
  completeManualExcessRefund(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('refundId') refundId: string,
    @Body() body: { externalReference: string },
  ) {
    return this.service
      .completeManualExcessRefund(
        this.context.requireClientId(u),
        id,
        refundId,
        u.id,
        body.externalReference,
      )
      .then((data) => ({ data }));
  }
  @Post(':id/refunds/:refundId/verify')
  @Roles(UserRole.CLIENT_ADMIN)
  verifyRefund(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('refundId') refundId: string,
  ) {
    return this.service
      .verifyExcessPaymentRefund(this.context.requireClientId(u), id, refundId)
      .then((data) => ({ data }));
  }
  @Post(':id/close') @Roles(UserRole.CLIENT_ADMIN) close(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service
      .close(this.context.requireClientId(u), id, u.id)
      .then((data) => ({ data }));
  }
}

@Controller('client/settlement-policy')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class SettlementPolicyController {
  constructor(
    private readonly context: ClientContextService,
    private readonly service: FinalSettlementService,
  ) {}
  @Get() get(@CurrentUser() u: AuthUser) {
    return this.service
      .policy(this.context.requireClientId(u))
      .then((data) => ({ data }));
  }
  @Post() set(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      depositApplicationEnabled: boolean;
      manualDepositRefundEnabled: boolean;
    },
  ) {
    return this.service
      .setPolicy(this.context.requireClientId(u), u.id, body)
      .then((data) => ({ data }));
  }
}

@Controller('client/riders/:riderId/financial-statement')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class OperationsFinancialStatementController {
  constructor(
    private readonly context: ClientContextService,
    private readonly service: FinalSettlementService,
  ) {}
  @Get() statement(
    @CurrentUser() u: AuthUser,
    @Param('riderId') riderId: string,
    @Query('agreementId') agreementId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service
      .statement(
        this.context.requireClientId(u),
        riderId,
        agreementId,
        from,
        to,
      )
      .then((data) => ({ data }));
  }
}

@Controller('rider-app/final-settlements')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderFinalSettlementController {
  constructor(
    private readonly context: ClientContextService,
    private readonly billing: RiderBillingService,
    private readonly service: FinalSettlementService,
  ) {}
  @Get(':id') async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const clientId = this.context.requireClientId(u);
    const riderId = await this.billing.riderForUser(clientId, u.id);
    const row = await this.service.get(clientId, id);
    if (row.riderId !== riderId)
      throw new NotFoundException('Settlement not found.');
    const preview = await this.service.preview(clientId, row.agreementId);
    return {
      data: {
        id: row.id,
        settlementNumber: row.settlementNumber,
        status: row.status,
        terminationDate: row.terminationDate,
        currency: row.currency,
        preview,
        charges: row.charges
          .filter((c) => c.status === 'APPROVED')
          .map((c) => ({
            chargeType: c.chargeType,
            description: c.description,
            approvedAmount: c.approvedAmount,
            evidence:
              c.evidence &&
              typeof c.evidence === 'object' &&
              !Array.isArray(c.evidence)
                ? {
                    photoIds: Array.isArray(
                      (c.evidence as Record<string, unknown>).photoIds,
                    )
                      ? (c.evidence as Record<string, unknown>).photoIds
                      : [],
                    documentIds: Array.isArray(
                      (c.evidence as Record<string, unknown>).documentIds,
                    )
                      ? (c.evidence as Record<string, unknown>).documentIds
                      : [],
                  }
                : null,
          })),
        depositApplications: row.applications.map((a) => ({
          depositId: a.depositId,
          amount: a.amount,
        })),
        refunds: row.refunds.map((r) => ({
          id: r.id,
          refundType: r.refundType,
          amount: r.amount,
          status: r.status,
          destinationType: r.destinationType,
          completedAt: r.completedAt,
        })),
      },
    };
  }
}

@Controller('rider-app/financial-statement')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderFinancialStatementController {
  constructor(
    private readonly context: ClientContextService,
    private readonly billing: RiderBillingService,
    private readonly service: FinalSettlementService,
  ) {}
  @Get() async statement(
    @CurrentUser() u: AuthUser,
    @Query('agreementId') agreementId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const clientId = this.context.requireClientId(u);
    const riderId = await this.billing.riderForUser(clientId, u.id);
    const result = await this.service.statement(
      clientId,
      riderId,
      agreementId,
      from,
      to,
    );
    return {
      data: {
        riderId,
        agreementId: result.agreementId,
        summary: result.summary,
        agreements: result.agreements.map((a) => ({
          agreementNumber: a.agreementNumber,
          startDate: a.startDate,
          terminationEffectiveAt: a.terminationEffectiveAt,
          commercialClosureState: a.commercialClosureState,
          vehicles: a.commercialVersions.map((v) => ({
            vehicleId: v.vehicleId,
            effectiveFrom: v.effectiveFrom,
            effectiveTo: v.effectiveTo,
          })),
        })),
        invoices: result.invoices.map((i) => ({
          invoiceNumber: i.invoiceNumber,
          totalAmount: i.totalAmount,
          outstandingAmount: i.outstandingAmount,
          lines: i.lines.map((l) => ({
            description: l.description,
            amount: l.amount,
          })),
        })),
        payments: result.payments.map((p) => ({
          amount: p.amount,
          receivedAt: p.receivedAt,
          method: p.method,
        })),
        deposits: result.deposits.map((d) => ({
          depositType: d.depositType,
          fundedAmount: d.fundedAmount,
          availableAmount: d.availableAmount,
          transactions: d.transactions.map((t) => ({
            transactionType: t.transactionType,
            amount: t.amount,
            createdAt: t.createdAt,
          })),
        })),
        notes: result.notes.map((n) => ({
          kind: n.kind,
          noteNumber: n.noteNumber,
          totalAmount: n.totalAmount,
          issuedAt: n.issuedAt,
        })),
        settlements: result.settlements.map((s) => ({
          settlementNumber: s.settlementNumber,
          status: s.status,
        })),
      },
    };
  }
}
