-- Refund service uses this sequence; the consolidated baseline omitted it.
CREATE SEQUENCE IF NOT EXISTS "PaymentRefund_number_seq";
SELECT setval('"PaymentRefund_number_seq"', GREATEST(
  (SELECT last_value + 1 FROM "PaymentRefund_number_seq"),
  COALESCE((SELECT MAX(substring("refundNumber" from '[0-9]+$')::bigint) + 1 FROM "PaymentRefund"), 1)
), false);
CREATE TABLE "PaymentAutomationJob" (
  "key" TEXT PRIMARY KEY,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastSucceededAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PaymentAutomationJob_nextAttemptAt_idx" ON "PaymentAutomationJob"("nextAttemptAt");
