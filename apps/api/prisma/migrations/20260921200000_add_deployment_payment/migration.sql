CREATE TYPE "DeploymentPaymentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'PAID', 'FAILED', 'CANCELLED');

CREATE TABLE "DeploymentPayment" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "status" "DeploymentPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "amount" DECIMAL(14,2) NOT NULL,
  "breakdown" JSONB NOT NULL,
  "provider" TEXT,
  "providerReference" TEXT,
  "submittedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeploymentPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeploymentPayment_workflowId_key" ON "DeploymentPayment"("workflowId");
CREATE UNIQUE INDEX "DeploymentPayment_providerReference_key" ON "DeploymentPayment"("providerReference");
CREATE INDEX "DeploymentPayment_clientId_status_idx" ON "DeploymentPayment"("clientId", "status");
ALTER TABLE "DeploymentPayment"
  ADD CONSTRAINT "DeploymentPayment_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "MobileDeploymentWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
