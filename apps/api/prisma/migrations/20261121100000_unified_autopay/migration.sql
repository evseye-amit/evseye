-- Additive only: no rider is enabled and no money is moved.
ALTER TABLE "RiderPaymentProfile" ADD COLUMN "collectionMode" VARCHAR(30) NOT NULL DEFAULT 'LEGACY_INVOICE';
ALTER TABLE "RiderPaymentProfile" ADD CONSTRAINT "RiderPaymentProfile_collectionMode_check" CHECK ("collectionMode" IN ('LEGACY_INVOICE', 'LEDGER_WALLET'));
ALTER TABLE "WalletAutoRechargePreference" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "RiderPaymentProfile_collectionMode_id_idx" ON "RiderPaymentProfile" ("collectionMode", "id");
ALTER TABLE "RiderPaymentProfile" ADD COLUMN "walletSettlementCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
