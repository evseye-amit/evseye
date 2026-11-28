ALTER TABLE "RiderBillingSchedule"
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  ADD COLUMN "automaticFrom" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  ADD COLUMN "recoveryApprovedThrough" TIMESTAMP(3),
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" VARCHAR(500);
CREATE INDEX "RiderBillingSchedule_status_nextAttemptAt_leaseUntil_idx" ON "RiderBillingSchedule"("status", "nextAttemptAt", "leaseUntil");
CREATE TABLE "RentalBillingWorkerRun" (
 "id" TEXT NOT NULL PRIMARY KEY, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 "finishedAt" TIMESTAMP(3), "status" VARCHAR(20) NOT NULL,
 "processed" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0,
 "deferred" INTEGER NOT NULL DEFAULT 0, "error" VARCHAR(500)
);
CREATE INDEX "RentalBillingWorkerRun_startedAt_idx" ON "RentalBillingWorkerRun"("startedAt");

ALTER TABLE "RiderPaymentProfile" ADD COLUMN "walletSettlementLastError" VARCHAR(500), ADD COLUMN "walletSettlementSuccessAt" TIMESTAMP(3);
