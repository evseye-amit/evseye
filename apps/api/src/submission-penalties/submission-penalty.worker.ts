import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PENALTY_INVOICE, payableStatuses } from './penalty-accounting.js';
@Injectable()
export class SubmissionPenaltyWorker {
  private running = false;
  private readonly logger = new Logger(SubmissionPenaltyWorker.name);
  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationService,
  ) {}
  @Interval(10000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.enqueuePending();
    } catch {
      this.logger.error('Submission penalty notifications will be retried.');
    } finally {
      this.running = false;
    }
  }
  async enqueuePending() {
    const rows = await this.db.riderInvoice.findMany({
      where: {
        invoiceType: PENALTY_INVOICE,
        client: { isActive: true, status: { notIn: ['DRAFT', 'SUSPENDED'] } },
        penaltyNotificationQueuedAt: null,
        status: { in: [...payableStatuses] },
        outstandingAmount: { gt: 0 },
        rider: { deletedAt: null, user: { isActive: true, deletedAt: null } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, clientId: true },
    });
    let queued = 0;
    for (const row of rows) {
      try {
        await this.db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "RiderInvoice" WHERE id = ${row.id} FOR UPDATE`;
            const invoice = await tx.riderInvoice.findFirstOrThrow({
              where: { id: row.id, clientId: row.clientId },
              include: { rider: { select: { userId: true } } },
            });
            if (
              invoice.penaltyNotificationQueuedAt ||
              !invoice.rider.userId ||
              invoice.outstandingAmount.lte(0)
            )
              return;
            await this.notifications.enqueueForUsers(
              tx,
              invoice.clientId,
              [invoice.rider.userId],
              {
                title: 'Scooter submission penalty',
                body: `Submission penalties of ${invoice.currency} ${invoice.totalAmount.toFixed(2)} are available for review and payment.`,
                data: {
                  type: 'SUBMISSION_PENALTY_PAYMENT',
                  invoiceId: invoice.id,
                  route: 'SUBMISSION_PENALTY_PAYMENT',
                },
              },
              `submission-penalty:${invoice.id}`,
              'SUBMISSION_PENALTY',
            );
            await tx.riderInvoice.update({
              where: { id: invoice.id },
              data: { penaltyNotificationQueuedAt: new Date() },
            });
            queued++;
          },
          { timeout: 20000 },
        );
      } catch {
        this.logger.warn({
          event: 'submission_penalty_notification_retry',
          invoiceId: row.id,
        });
      }
    }
    return queued;
  }
}
