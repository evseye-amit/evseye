CREATE TABLE "DeploymentPaymentAttempt" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "deploymentPaymentId" TEXT NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "providerKeyReference" VARCHAR(512),
  "providerOrderId" VARCHAR(160),
  "amountPaise" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'CREATING',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeploymentPaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeploymentPaymentCapture" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "providerPaymentId" VARCHAR(160) NOT NULL,
  "amountPaise" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(150),
  "providerRefundId" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeploymentPaymentCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeploymentPaymentAttempt_providerOrderId_key" ON "DeploymentPaymentAttempt"("providerOrderId");
CREATE INDEX "DeploymentPaymentAttempt_clientId_deploymentPaymentId_createdAt_idx" ON "DeploymentPaymentAttempt"("clientId", "deploymentPaymentId", "createdAt");
CREATE INDEX "DeploymentPaymentAttempt_provider_status_checkedAt_idx" ON "DeploymentPaymentAttempt"("provider", "status", "checkedAt");
CREATE UNIQUE INDEX "DeploymentPaymentCapture_providerPaymentId_key" ON "DeploymentPaymentCapture"("providerPaymentId");
CREATE UNIQUE INDEX "DeploymentPaymentCapture_providerRefundId_key" ON "DeploymentPaymentCapture"("providerRefundId");
CREATE INDEX "DeploymentPaymentCapture_status_updatedAt_idx" ON "DeploymentPaymentCapture"("status", "updatedAt");

-- Preserve existing Razorpay deployment attempts before the application starts
-- writing the provider-neutral records.
INSERT INTO "DeploymentPaymentAttempt" (
  "id", "clientId", "deploymentPaymentId", "provider", "providerKeyReference",
  "providerOrderId", "amountPaise", "currency", "status", "createdAt", "checkedAt", "updatedAt"
)
SELECT
  rdo."id", rdo."clientId", rdo."deploymentPaymentId", 'RAZORPAY', rdo."keyId",
  rdo."providerOrderId", rdo."amountPaise", rdo."currency", rdo."status",
  rdo."createdAt", rdo."checkedAt", rdo."updatedAt"
FROM "RazorpayDeploymentOrder" rdo;

INSERT INTO "DeploymentPaymentCapture" (
  "id", "attemptId", "providerPaymentId", "amountPaise", "currency", "status",
  "reason", "providerRefundId", "createdAt", "updatedAt"
)
SELECT
  rdc."id", rdc."orderId", rdc."providerPaymentId", rdc."amountPaise", rdc."currency",
  rdc."status", rdc."reason", rdc."providerRefundId", rdc."createdAt", rdc."updatedAt"
FROM "RazorpayDeploymentCapture" rdc;

ALTER TABLE "DeploymentPaymentAttempt" ADD CONSTRAINT "DeploymentPaymentAttempt_clientId_deploymentPaymentId_fkey"
  FOREIGN KEY ("clientId", "deploymentPaymentId") REFERENCES "DeploymentPayment"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeploymentPaymentCapture" ADD CONSTRAINT "DeploymentPaymentCapture_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "DeploymentPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentProviderEvent" ADD COLUMN "deploymentAttemptId" TEXT;
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_deploymentAttemptId_fkey"
  FOREIGN KEY ("deploymentAttemptId") REFERENCES "DeploymentPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PaymentProviderEvent_deploymentAttemptId_idx" ON "PaymentProviderEvent"("deploymentAttemptId");

UPDATE "PaymentProviderEvent" e
SET "deploymentAttemptId" = e."deploymentOrderId"
WHERE e."deploymentOrderId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "DeploymentPaymentAttempt" a WHERE a."id" = e."deploymentOrderId"
  );
