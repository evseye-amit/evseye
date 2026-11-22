CREATE TABLE "AppUpdatePolicy" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "appCode" VARCHAR(40) NOT NULL,
  "platform" VARCHAR(10) NOT NULL,
  "applicationId" VARCHAR(200) NOT NULL,
  "channel" VARCHAR(20) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "draft" JSONB,
  "published" JSONB,
  "publishedRevision" INTEGER,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppUpdatePolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppUpdatePolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppUpdatePolicy_appCode_check" CHECK ("appCode" IN ('RIDER_APP', 'FLEET_MANAGER_APP')),
  CONSTRAINT "AppUpdatePolicy_platform_check" CHECK ("platform" IN ('ANDROID', 'IOS')),
  CONSTRAINT "AppUpdatePolicy_channel_check" CHECK ("channel" IN ('PRODUCTION', 'TEST'))
);
CREATE UNIQUE INDEX "AppUpdatePolicy_scope_key" ON "AppUpdatePolicy"("clientId", "appCode", "platform", "applicationId", "channel");
CREATE TABLE "AppUpdatePolicyRevision" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" VARCHAR(30) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppUpdatePolicyRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppUpdatePolicyRevision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AppUpdatePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AppUpdatePolicyRevision_policyId_revision_key" ON "AppUpdatePolicyRevision"("policyId", "revision");
-- Deliberately no seed policies: deployment alone must not block installed apps.
