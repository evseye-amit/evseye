CREATE TABLE "ProviderSettlement" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "providerSettlementId" VARCHAR(160) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "grossAmount" DECIMAL(18,2) NOT NULL,
  "refundAmount" DECIMAL(18,2) NOT NULL,
  "feeAmount" DECIMAL(18,2) NOT NULL,
  "taxAmount" DECIMAL(18,2) NOT NULL,
  "netAmount" DECIMAL(18,2) NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL,
  "utr" VARCHAR(160),
  "importHash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'REQUIRES_REVIEW',
  "importedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSettlement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProviderSettlementItem" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "providerReference" VARCHAR(160) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "localReferenceId" TEXT,
  "reviewCode" VARCHAR(60),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSettlementItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderSettlement_clientId_provider_providerSettlementId_key" ON "ProviderSettlement"("clientId", "provider", "providerSettlementId");
CREATE UNIQUE INDEX "ProviderSettlement_clientId_id_key" ON "ProviderSettlement"("clientId", "id");
CREATE INDEX "ProviderSettlement_clientId_status_settledAt_idx" ON "ProviderSettlement"("clientId", "status", "settledAt");
CREATE UNIQUE INDEX "ProviderSettlementItem_settlementId_kind_providerReference_key" ON "ProviderSettlementItem"("settlementId", "kind", "providerReference");
CREATE INDEX "ProviderSettlementItem_clientId_status_createdAt_idx" ON "ProviderSettlementItem"("clientId", "status", "createdAt");
ALTER TABLE "ProviderSettlementItem" ADD CONSTRAINT "ProviderSettlementItem_clientId_settlementId_fkey" FOREIGN KEY ("clientId", "settlementId") REFERENCES "ProviderSettlement"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderSettlement" ADD CONSTRAINT "ProviderSettlement_nonnegative_check" CHECK ("grossAmount" >= 0 AND "refundAmount" >= 0 AND "feeAmount" >= 0 AND "taxAmount" >= 0 AND "netAmount" >= 0);
ALTER TABLE "ProviderSettlementItem" ADD CONSTRAINT "ProviderSettlementItem_positive_amount_check" CHECK ("amount" > 0);
