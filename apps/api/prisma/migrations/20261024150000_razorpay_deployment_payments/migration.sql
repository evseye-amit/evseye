-- AlterTable
ALTER TABLE "PaymentProviderEvent" ADD COLUMN     "deploymentOrderId" TEXT,
ADD COLUMN     "deploymentPayload" JSONB;

-- CreateTable
CREATE TABLE "RazorpayDeploymentOrder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deploymentPaymentId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayDeploymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayDeploymentCapture" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(150),
    "providerRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayDeploymentCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayDeploymentOrder_providerOrderId_key" ON "RazorpayDeploymentOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "RazorpayDeploymentOrder_deploymentPaymentId_createdAt_idx" ON "RazorpayDeploymentOrder"("deploymentPaymentId", "createdAt");

-- CreateIndex
CREATE INDEX "RazorpayDeploymentOrder_status_checkedAt_idx" ON "RazorpayDeploymentOrder"("status", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayDeploymentCapture_providerPaymentId_key" ON "RazorpayDeploymentCapture"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayDeploymentCapture_providerRefundId_key" ON "RazorpayDeploymentCapture"("providerRefundId");

-- CreateIndex
CREATE INDEX "RazorpayDeploymentCapture_status_updatedAt_idx" ON "RazorpayDeploymentCapture"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentPayment_clientId_id_key" ON "DeploymentPayment"("clientId", "id");

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_deploymentOrderId_fkey" FOREIGN KEY ("deploymentOrderId") REFERENCES "RazorpayDeploymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayDeploymentOrder" ADD CONSTRAINT "RazorpayDeploymentOrder_clientId_deploymentPaymentId_fkey" FOREIGN KEY ("clientId", "deploymentPaymentId") REFERENCES "DeploymentPayment"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RazorpayDeploymentCapture" ADD CONSTRAINT "RazorpayDeploymentCapture_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RazorpayDeploymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

