import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import { VerificationService } from './verification.service.js';

@Injectable()
export class KycVerificationOutboxWorker {
  private readonly logger = new Logger(KycVerificationOutboxWorker.name);
  constructor(private readonly prisma: PrismaService, private readonly verification: VerificationService) {}

  @Cron('*/10 * * * * *')
  async drain() {
    const stale = new Date(Date.now() - 5 * 60_000);
    await (this.prisma as unknown as { kycVerificationOutbox: any }).kycVerificationOutbox.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: stale } },
      data: { status: 'FAILED', lockedAt: null, availableAt: new Date() },
    });
    const outbox = (this.prisma as unknown as { kycVerificationOutbox: any }).kycVerificationOutbox;
    const rows = await outbox.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 }, availableAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 25, select: { id: true } });
    for (const row of rows) {
      try { await this.verification.processOutbox(row.id); }
      catch (error) { this.logger.warn(`KYC outbox item ${row.id} failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
  }
}
