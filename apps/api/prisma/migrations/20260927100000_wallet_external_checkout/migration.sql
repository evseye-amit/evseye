ALTER TYPE "WalletAccountType" ADD VALUE 'PROVIDER_CLEARING';

ALTER TABLE "PaymentCollectionRequest" ADD COLUMN "paymentSnapshot" JSONB;
ALTER TABLE "PaymentCollectionRequest" ADD COLUMN "paymentNumber" VARCHAR(50);
CREATE UNIQUE INDEX "PaymentCollectionRequest_paymentNumber_key" ON "PaymentCollectionRequest"("paymentNumber");

CREATE TABLE "ProviderPaymentObservation" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "providerOrderId" VARCHAR(80) NOT NULL,
  "providerPaymentId" VARCHAR(120) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "amount" DECIMAL(14,2),
  "currency" CHAR(3),
  "reviewCode" VARCHAR(80),
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderPaymentObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderPaymentObservation_positive_amount" CHECK ("amount" IS NULL OR "amount" > 0),
  CONSTRAINT "ProviderPaymentObservation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PaymentCollectionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProviderPaymentObservation_provider_providerPaymentId_key" ON "ProviderPaymentObservation"("provider", "providerPaymentId");
CREATE INDEX "ProviderPaymentObservation_clientId_collectionId_observedAt_idx" ON "ProviderPaymentObservation"("clientId", "collectionId", "observedAt");
CREATE INDEX "ProviderPaymentObservation_clientId_reviewCode_observedAt_idx" ON "ProviderPaymentObservation"("clientId", "reviewCode", "observedAt");
