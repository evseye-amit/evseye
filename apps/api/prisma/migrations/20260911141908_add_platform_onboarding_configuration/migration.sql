-- CreateTable
CREATE TABLE "OnboardingStepDefinition" (
    "stepKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "stage" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "handlerClass" TEXT NOT NULL,
    "uiComponent" TEXT NOT NULL,
    "isLockable" BOOLEAN NOT NULL DEFAULT false,
    "supportsDocument" BOOLEAN NOT NULL DEFAULT false,
    "supportsRevalidation" BOOLEAN NOT NULL DEFAULT false,
    "defaultEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultMandatory" BOOLEAN NOT NULL DEFAULT true,
    "tenantEditable" BOOLEAN NOT NULL DEFAULT false,
    "requiresOpsApproval" BOOLEAN NOT NULL DEFAULT true,
    "schemaDefinition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingStepDefinition_pkey" PRIMARY KEY ("stepKey")
);

-- CreateTable
CREATE TABLE "RiderOnboardingConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderOnboardingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderOnboardingConfigStep" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "sequenceNo" INTEGER NOT NULL,
    "verificationMode" TEXT NOT NULL DEFAULT 'AUTO',
    "fallbackMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "maxRetryAttempts" INTEGER NOT NULL DEFAULT 3,
    "slaHours" INTEGER,
    "dependsOn" JSONB NOT NULL,
    "applicableModels" JSONB,
    "params" JSONB NOT NULL,
    "revalidationIntervalDays" INTEGER,
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderOnboardingConfigStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderOnboardingConfig_tenantId_status_idx" ON "RiderOnboardingConfig"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderOnboardingConfig_tenantId_version_key" ON "RiderOnboardingConfig"("tenantId", "version");

-- CreateIndex
CREATE INDEX "RiderOnboardingConfigStep_configId_sequenceNo_idx" ON "RiderOnboardingConfigStep"("configId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "RiderOnboardingConfigStep_configId_stepKey_key" ON "RiderOnboardingConfigStep"("configId", "stepKey");

-- AddForeignKey
ALTER TABLE "RiderOnboardingConfig" ADD CONSTRAINT "RiderOnboardingConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingConfigStep" ADD CONSTRAINT "RiderOnboardingConfigStep_configId_fkey" FOREIGN KEY ("configId") REFERENCES "RiderOnboardingConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingConfigStep" ADD CONSTRAINT "RiderOnboardingConfigStep_stepKey_fkey" FOREIGN KEY ("stepKey") REFERENCES "OnboardingStepDefinition"("stepKey") ON DELETE RESTRICT ON UPDATE CASCADE;
