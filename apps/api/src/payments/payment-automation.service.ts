import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PaymentAutomationService {
  private readonly logger = new Logger(PaymentAutomationService.name);
  constructor(private readonly db: PrismaService) {}
  async run(key: string, work: () => Promise<boolean>, successDelaySeconds = 3600) {
    if (!Number.isSafeInteger(successDelaySeconds) || successDelaySeconds < 1 || successDelaySeconds > 86400)
      throw new RangeError('Automation success delay must be between 1 and 86400 seconds.');
    const token = randomUUID();
    const claimed = await this.db.$queryRaw<Array<{ attempts: number }>>`
      INSERT INTO "PaymentAutomationJob" ("key", "leaseToken", "leaseUntil")
      VALUES (${key}, ${token}, NOW() + INTERVAL '5 minutes')
      ON CONFLICT ("key") DO UPDATE SET "leaseToken"=${token}, "leaseUntil"=NOW()+INTERVAL '5 minutes', "updatedAt"=NOW()
      WHERE ("PaymentAutomationJob"."leaseUntil" IS NULL OR "PaymentAutomationJob"."leaseUntil" < NOW())
        AND "PaymentAutomationJob"."nextAttemptAt" <= NOW()
      RETURNING "attempts"`;
    if (!claimed.length) return false;
    // Long provider pagination must not expire a healthy worker's lease.
    const heartbeat = setInterval(() => {
      void this.db.$executeRaw`UPDATE "PaymentAutomationJob" SET "leaseUntil"=NOW()+INTERVAL '5 minutes', "updatedAt"=NOW()
        WHERE "key"=${key} AND "leaseToken"=${token}`.catch(() => {
        this.logger.warn(JSON.stringify({ event: 'PAYMENT_AUTOMATION_LEASE_RENEWAL_FAILED', key }));
      });
    }, 60000);
    heartbeat.unref();
    let complete = false, failed = false;
    try { complete = await work(); }
    catch { failed = true; this.logger.warn(JSON.stringify({ event: 'PAYMENT_AUTOMATION_RETRY', key })); }
    finally { clearInterval(heartbeat); }
    const attempts = complete ? 0 : Math.min(claimed[0].attempts + 1, 20);
    const delay = complete ? successDelaySeconds : Math.min(60 * 2 ** Math.min(attempts, 6), 3600);
    await this.db.$executeRaw`UPDATE "PaymentAutomationJob" SET "leaseToken"=NULL, "leaseUntil"=NULL,
      "attempts"=${attempts}, "nextAttemptAt"=NOW()+(${delay} * INTERVAL '1 second'),
      "lastError"=${failed ? 'VERIFICATION_FAILED' : complete ? null : 'PROVIDER_PENDING'},
      "lastSucceededAt"=CASE WHEN ${complete} THEN NOW() ELSE "lastSucceededAt" END, "updatedAt"=NOW()
      WHERE "key"=${key} AND "leaseToken"=${token}`;
    return true;
  }
}
