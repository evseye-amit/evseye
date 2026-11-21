ALTER TABLE "PaymentMandate"
  ADD COLUMN "walletSetupIntent" JSONB,
  ADD COLUMN "walletActivationCompletedAt" TIMESTAMP(3),
  ADD COLUMN "walletActivationCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "walletActivationFailure" VARCHAR(80);
CREATE INDEX "PaymentMandate_wallet_activation_idx"
  ON "PaymentMandate" ("status", "walletActivationCompletedAt", "walletActivationCheckedAt");
