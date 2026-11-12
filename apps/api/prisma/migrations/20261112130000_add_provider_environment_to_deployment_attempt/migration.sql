ALTER TABLE "DeploymentPaymentAttempt"
ADD COLUMN "providerEnvironment" VARCHAR(32);

CREATE INDEX "DeploymentPaymentAttempt_provider_environment_idx"
ON "DeploymentPaymentAttempt"("provider", "providerEnvironment");
