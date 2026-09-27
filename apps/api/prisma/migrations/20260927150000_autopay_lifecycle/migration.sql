ALTER TABLE "PaymentMandate" ADD COLUMN "mandateNumber" VARCHAR(50), ADD COLUMN "autoDebitEnabled" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "PaymentMandate_mandateNumber_key" ON "PaymentMandate"("mandateNumber");
ALTER TABLE "PaymentTransaction" ADD COLUMN "debitNumber" VARCHAR(50);
CREATE UNIQUE INDEX "PaymentTransaction_debitNumber_key" ON "PaymentTransaction"("debitNumber");
ALTER TABLE "PaymentCollectionPolicy" ADD COLUMN "walletFirst" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "AutoPayDunningCase" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "graceUntil" TIMESTAMP(3),
  "failureCode" VARCHAR(80),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutoPayDunningCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutoPayDunningCase_failedAttempts_check" CHECK ("failedAttempts" >= 0)
);
CREATE UNIQUE INDEX "AutoPayDunningCase_clientId_invoiceId_key" ON "AutoPayDunningCase"("clientId", "invoiceId");
CREATE INDEX "AutoPayDunningCase_clientId_status_nextRetryAt_idx" ON "AutoPayDunningCase"("clientId", "status", "nextRetryAt");
CREATE INDEX "AutoPayDunningCase_clientId_riderId_status_idx" ON "AutoPayDunningCase"("clientId", "riderId", "status");
ALTER TABLE "AutoPayDunningCase" ADD CONSTRAINT "AutoPayDunningCase_invoice_fkey" FOREIGN KEY ("clientId", "invoiceId") REFERENCES "RiderInvoice"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutoPayDunningCase" ADD CONSTRAINT "AutoPayDunningCase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutoPayDunningCase" ADD CONSTRAINT "AutoPayDunningCase_rider_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
