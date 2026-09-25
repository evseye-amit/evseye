import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralFraudType, ReferralStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReferralAccessService } from './referral-access.service.js';
import { ReferralQualificationService } from './referral-qualification.service.js';

@Injectable()
export class ReferralFraudService {
  private readonly logger = new Logger(ReferralFraudService.name);
  constructor(private readonly prisma: PrismaService, private readonly access: ReferralAccessService, private readonly qualification: ReferralQualificationService) {}

  async review(clientId: string, actorId: string, referralId: string, checkType: ReferralFraudType, reason: string, clear: boolean) {
    await this.access.requireFeature(clientId);
    const check = await this.prisma.$transaction(async (tx) => {
      const row = await tx.referral.findFirst({ where: { id: referralId, clientId }, select: { id: true, status: true } });
      if (!row) throw new NotFoundException('Referral not found.');
      if (['QUALIFIED', 'REWARD_PENDING', 'REWARD_APPROVED', 'PAID', 'REJECTED', 'EXPIRED'].includes(row.status)) throw new ConflictException('Financial or final referral states cannot be changed through fraud review.');
      const check = await tx.referralFraudCheck.upsert({ where: { referralId_checkType: { referralId, checkType } }, create: { clientId, referralId, checkType, result: clear ? 'CLEAR' : 'REVIEW', details: { reason: reason.trim() } }, update: { result: clear ? 'CLEAR' : 'REVIEW', details: { reason: reason.trim() }, checkedAt: new Date() } });
      const otherReviews = clear ? await tx.referralFraudCheck.count({ where: { clientId, referralId, result: 'REVIEW' } }) : 1;
      const status = otherReviews ? ReferralStatus.FRAUD_SUSPECTED : ReferralStatus.MILESTONE_IN_PROGRESS;
      await tx.referral.updateMany({ where: { id: referralId, clientId }, data: { status } });
      await tx.auditLog.create({ data: { clientId, actorId, action: clear ? 'REFERRAL_FRAUD_CLEARED' : 'REFERRAL_FRAUD_FLAGGED', entityType: 'Referral', entityId: referralId, previousData: { status: row.status }, newData: { status, checkType, reason: reason.trim() } } });
      return check;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (clear) {
      try { await this.qualification.recheck(clientId, referralId); }
      catch (cause) { this.logger.error(`Referral qualification recheck failed for ${referralId}`, cause); }
    }
    return check;
  }
}
