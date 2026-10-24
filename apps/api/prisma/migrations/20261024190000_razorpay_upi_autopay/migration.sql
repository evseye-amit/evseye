-- AlterTable
ALTER TABLE "PaymentMandate" ADD COLUMN     "authorizationUrl" VARCHAR(1000),
ADD COLUMN     "providerAuthorizationOrderId" VARCHAR(100),
ADD COLUMN     "providerAuthorizationPaymentId" VARCHAR(100),
ADD COLUMN     "providerCancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "providerCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "providerCreateClaimedAt" TIMESTAMP(3),
ADD COLUMN     "providerCustomerEmail" VARCHAR(254),
ADD COLUMN     "providerCustomerId" VARCHAR(100),
ADD COLUMN     "providerFrequency" VARCHAR(30),
ADD COLUMN     "providerKeyId" VARCHAR(100),
ADD COLUMN     "providerRegistrationId" VARCHAR(100),
ADD COLUMN     "providerTermsSnapshot" JSONB,
ADD COLUMN     "providerTokenId" VARCHAR(100);

-- AlterTable
ALTER TABLE "PaymentProviderEvent" ADD COLUMN     "recurringPayload" JSONB;

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "gatewayPaymentId" VARCHAR(100),
ADD COLUMN     "providerCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "providerDebitClaimedAt" TIMESTAMP(3),
ADD COLUMN     "providerKeyId" VARCHAR(100),
ADD COLUMN     "providerOrderClaimedAt" TIMESTAMP(3),
ADD COLUMN     "providerOrderId" VARCHAR(100);

-- CreateTable
CREATE TABLE "RazorpayAutoPayCapture" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "providerPaymentId" VARCHAR(120) NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpayAutoPayCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayAutoPayCapture_providerPaymentId_key" ON "RazorpayAutoPayCapture"("providerPaymentId");

-- CreateIndex
CREATE INDEX "RazorpayAutoPayCapture_transactionId_createdAt_idx" ON "RazorpayAutoPayCapture"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "RazorpayAutoPayCapture_status_createdAt_idx" ON "RazorpayAutoPayCapture"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerTokenId_key" ON "PaymentMandate"("providerTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerRegistrationId_key" ON "PaymentMandate"("providerRegistrationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerAuthorizationOrderId_key" ON "PaymentMandate"("providerAuthorizationOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMandate_providerAuthorizationPaymentId_key" ON "PaymentMandate"("providerAuthorizationPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_providerOrderId_key" ON "PaymentTransaction"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_gatewayPaymentId_key" ON "PaymentTransaction"("gatewayPaymentId");

-- AddForeignKey
ALTER TABLE "RazorpayAutoPayCapture" ADD CONSTRAINT "RazorpayAutoPayCapture_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reconciliation polls oldest checked records independently of the default provider.
CREATE INDEX "PaymentMandate_provider_providerCheckedAt_idx" ON "PaymentMandate"("provider", "providerCheckedAt");
CREATE INDEX "PaymentTransaction_provider_providerCheckedAt_idx" ON "PaymentTransaction"("provider", "providerCheckedAt");
