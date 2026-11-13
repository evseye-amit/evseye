import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentAutomationService } from './payment-automation.service.js';
@Injectable()
export class PaymentAlertService {
  constructor(
    private readonly db: PrismaService,
    private readonly automation: PaymentAutomationService,
  ) {}
  async raise(clientId: string, kind: string, referenceId: string) {
    const where = {
      clientId_kind_referenceId: { clientId, kind, referenceId },
    };
    try {
      return await this.db.paymentOperationalAlert.upsert({
        where,
        create: { clientId, kind, referenceId, routedRole: 'CLIENT_ADMIN' },
        update: {},
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return this.db.paymentOperationalAlert.findUniqueOrThrow({ where });
      throw error;
    }
  }
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scan() {
    await this.automation.run(
      'worker:payment-alerts',
      async () => {
        const before = new Date(Date.now() - 86400000);
        // Exclude already routed sources in SQL so a permanent old exception cannot starve newer alerts.
        const sources = await this.db.$queryRaw<
          Array<{ clientId: string; kind: string; referenceId: string }>
        >`
        SELECT q.* FROM (
          SELECT "clientId", 'AGED_REFUND' AS kind, id AS "referenceId" FROM "PaymentRefund" WHERE status IN ('CREATING','PENDING','PROCESSING','UNKNOWN') AND "requestedAt" < ${before}
          UNION ALL SELECT "clientId", 'SETTLEMENT_REVIEW', id FROM "ProviderSettlement" WHERE status='REQUIRES_REVIEW'
          UNION ALL SELECT "clientId", 'BANK_CONFIRMATION_DUE', id FROM "ProviderSettlement" WHERE "bankConfirmedAt" IS NULL AND "settledAt" < ${before}
          UNION ALL SELECT "clientId", 'WEBHOOK_REVIEW', id FROM "PaymentProviderEvent" WHERE status='FAILED' AND "clientId" IS NOT NULL
        ) q WHERE NOT EXISTS (SELECT 1 FROM "PaymentOperationalAlert" a WHERE a."clientId"=q."clientId" AND a.kind=q.kind AND a."referenceId"=q."referenceId")
        ORDER BY q."clientId", q.kind, q."referenceId" LIMIT 200`;
        for (const source of sources)
          await this.raise(source.clientId, source.kind, source.referenceId);
        return true;
      },
      30,
    );
  }
  assignees(clientId: string) {
    return this.db.user.findMany({
      where: {
        clientId,
        role: 'CLIENT_ADMIN',
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }
  list(clientId: string, page = 1) {
    return this.db.paymentOperationalAlert.findMany({
      where: { clientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 100,
      take: 100,
    });
  }
  async route(
    clientId: string,
    id: string,
    actorId: string,
    assigneeId: string | null,
    acknowledge: boolean,
  ) {
    if (assigneeId !== null && typeof assigneeId !== 'string')
      throw new BadRequestException('INVALID_ALERT_ASSIGNEE');
    return this.db.$transaction(async (tx) => {
      const row = await tx.paymentOperationalAlert.findFirst({
        where: { id, clientId },
      });
      if (!row) throw new NotFoundException('ALERT_NOT_FOUND');
      if (
        assigneeId &&
        !(await tx.user.findFirst({
          where: {
            id: assigneeId,
            clientId,
            role: 'CLIENT_ADMIN',
            isActive: true,
            deletedAt: null,
          },
        }))
      )
        throw new BadRequestException('ASSIGNEE_MUST_BE_WORKSPACE_ADMIN');
      const updated = await tx.paymentOperationalAlert.update({
        where: { id },
        data: {
          assigneeId,
          ...(acknowledge
            ? { acknowledgedAt: new Date(), acknowledgedById: actorId }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          clientId,
          actorId,
          action: 'PAYMENT_ALERT_ROUTED',
          entityType: 'PaymentOperationalAlert',
          entityId: id,
          newData: { assigneeId, acknowledge },
        },
      });
      return updated;
    });
  }
}
