ALTER TYPE "FeatureCategory" ADD VALUE IF NOT EXISTS 'PRE_LOGIN';

CREATE TABLE "FeatureRevision" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeatureRevision_featureId_version_key" ON "FeatureRevision"("featureId", "version");
CREATE INDEX "FeatureRevision_featureId_publishedAt_idx" ON "FeatureRevision"("featureId", "publishedAt");
ALTER TABLE "FeatureRevision" ADD CONSTRAINT "FeatureRevision_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PackageRevision" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PackageRevision_packageId_version_key" ON "PackageRevision"("packageId", "version");
CREATE INDEX "PackageRevision_packageId_publishedAt_idx" ON "PackageRevision"("packageId", "publishedAt");
ALTER TABLE "PackageRevision" ADD CONSTRAINT "PackageRevision_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientSubscription" ADD COLUMN "packageRevisionId" TEXT;
CREATE INDEX "ClientSubscription_packageRevisionId_idx" ON "ClientSubscription"("packageRevisionId");
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_packageRevisionId_fkey" FOREIGN KEY ("packageRevisionId") REFERENCES "PackageRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientWorkflowRevision" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientWorkflowRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientWorkflowRevision_subscriptionId_version_key" ON "ClientWorkflowRevision"("subscriptionId", "version");
CREATE INDEX "ClientWorkflowRevision_subscriptionId_publishedAt_idx" ON "ClientWorkflowRevision"("subscriptionId", "publishedAt");
ALTER TABLE "ClientWorkflowRevision" ADD CONSTRAINT "ClientWorkflowRevision_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
