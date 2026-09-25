CREATE TYPE "PaymentTransactionStatus" AS ENUM ('CREATING', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'UNKNOWN');

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "mandateId" TEXT NOT NULL,
  "requestKey" VARCHAR(120) NOT NULL,
  "provider" VARCHAR(30) NOT NULL DEFAULT 'CASHFREE',
  "providerPaymentId" VARCHAR(250) NOT NULL,
  "providerReference" VARCHAR(120),
  "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATING',
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentTransaction_clientId_id_key" ON "PaymentTransaction"("clientId", "id");
CREATE UNIQUE INDEX "PaymentTransaction_clientId_invoiceId_key" ON "PaymentTransaction"("clientId", "invoiceId");
CREATE UNIQUE INDEX "PaymentTransaction_clientId_requestKey_key" ON "PaymentTransaction"("clientId", "requestKey");
CREATE UNIQUE INDEX "PaymentTransaction_provider_providerPaymentId_key" ON "PaymentTransaction"("provider", "providerPaymentId");
CREATE INDEX "PaymentTransaction_clientId_riderId_status_idx" ON "PaymentTransaction"("clientId", "riderId", "status");
CREATE INDEX "PaymentTransaction_clientId_mandateId_status_idx" ON "PaymentTransaction"("clientId", "mandateId", "status");
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_invoiceId_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATING',
  "providerPaymentId" VARCHAR(250) NOT NULL,
  "providerReference" VARCHAR(120),
  "providerStatus" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentAttempt_transactionId_sequence_key" ON "PaymentAttempt"("transactionId", "sequence");
CREATE UNIQUE INDEX "PaymentAttempt_clientId_providerPaymentId_key" ON "PaymentAttempt"("clientId", "providerPaymentId");
CREATE INDEX "PaymentAttempt_clientId_status_createdAt_idx" ON "PaymentAttempt"("clientId", "status", "createdAt");
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_clientId_transactionId_fkey" FOREIGN KEY ("clientId", "transactionId") REFERENCES "PaymentTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentProviderEvent" ADD COLUMN "paymentTransactionId" TEXT;
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_clientId_paymentTransactionId_fkey" FOREIGN KEY ("clientId", "paymentTransactionId") REFERENCES "PaymentTransaction"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
