ALTER TABLE "PaymentRefund" ADD COLUMN "origin" VARCHAR(16) NOT NULL DEFAULT 'INTERNAL', ADD COLUMN "externalReference" VARCHAR(120);
CREATE UNIQUE INDEX "PaymentRefund_clientId_provider_externalReference_key" ON "PaymentRefund"("clientId", "provider", "externalReference");
ALTER TABLE "ProviderSettlement" ADD COLUMN "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL', ADD COLUMN "configurationVersionId" TEXT,
 ADD COLUMN "bankConfirmedAt" TIMESTAMP(3), ADD COLUMN "bankConfirmedById" TEXT, ADD COLUMN "bankCreditedAt" TIMESTAMP(3),
 ADD COLUMN "bankUtr" VARCHAR(160), ADD COLUMN "bankAccountLast4" VARCHAR(4), ADD COLUMN "bankEvidenceReference" VARCHAR(300);
ALTER TABLE "ProviderSettlement" ADD CONSTRAINT "ProviderSettlement_merchant_fkey" FOREIGN KEY ("configurationVersionId", "clientId") REFERENCES "PaymentProviderConfigurationVersion"("id", "clientId") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "ProviderSettlement_clientId_bankUtr_key" ON "ProviderSettlement"("clientId", "bankUtr");
CREATE TABLE "PaymentOperationalAlert" (
 "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL REFERENCES "Client"("id") ON DELETE RESTRICT,
 "kind" VARCHAR(40) NOT NULL, "referenceId" TEXT NOT NULL, "routedRole" VARCHAR(30) NOT NULL DEFAULT 'CLIENT_ADMIN',
 "assigneeId" TEXT, "acknowledgedAt" TIMESTAMP(3), "acknowledgedById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PaymentOperationalAlert_clientId_kind_referenceId_key" ON "PaymentOperationalAlert"("clientId", "kind", "referenceId");
CREATE INDEX "PaymentOperationalAlert_clientId_createdAt_idx" ON "PaymentOperationalAlert"("clientId", "createdAt");
