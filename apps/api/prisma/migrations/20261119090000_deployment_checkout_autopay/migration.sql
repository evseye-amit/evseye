ALTER TABLE "DeploymentPaymentAttempt"
ADD COLUMN "autoPayRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoPayRequestKey" VARCHAR(120),
ADD COLUMN "autoPayRequestHash" VARCHAR(64),
ADD COLUMN "autoPayEmail" VARCHAR(254),
ADD COLUMN "autoPayCustomerId" VARCHAR(100),
ADD COLUMN "autoPayMaxAmount" DECIMAL(14,2),
ADD COLUMN "autoPayExpiresAt" TIMESTAMP(3),
ADD COLUMN "autoPayConsent" JSONB,
ADD COLUMN "autoPayOrderClaimedAt" TIMESTAMP(3),
ADD COLUMN "autoPayTokenId" VARCHAR(100),
ADD COLUMN "autoPayAuthorizationPaymentId" VARCHAR(100),
ADD COLUMN "autoPayStatus" VARCHAR(32),
ADD COLUMN "autoPayFailureCode" VARCHAR(80),
ADD COLUMN "autoPayMandateId" TEXT;
CREATE UNIQUE INDEX "DeploymentPaymentAttempt_clientId_autoPayRequestKey_key" ON "DeploymentPaymentAttempt" ("clientId", "autoPayRequestKey");
CREATE INDEX "DeploymentPaymentAttempt_autoPay_recovery_idx" ON "DeploymentPaymentAttempt" ("autoPayRequested", "autoPayStatus", "checkedAt");
ALTER TABLE "DeploymentPaymentAttempt" ADD CONSTRAINT "DeploymentPaymentAttempt_autoPayMandate_fkey" FOREIGN KEY ("clientId", "autoPayMandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeploymentPaymentCapture"
ADD COLUMN "autoPayTokenId" VARCHAR(100),
ADD COLUMN "autoPayCleanupReason" VARCHAR(80),
ADD COLUMN "autoPayCleanupStatus" VARCHAR(32);
