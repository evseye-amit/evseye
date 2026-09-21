ALTER TABLE "MobileDeploymentWorkflow"
  ADD COLUMN "pairingBypassReason" TEXT,
  ADD COLUMN "pairingHealthSnapshot" JSONB;
