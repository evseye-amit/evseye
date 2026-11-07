-- DropIndex
DROP INDEX "ClientSubscription_packageRevisionId_idx";

-- DropIndex
DROP INDEX "idx_hub_location";

-- CreateTable
CREATE TABLE "ClientFeatureRevision" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFeatureRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientFeatureRevision_subscriptionId_publishedAt_idx" ON "ClientFeatureRevision"("subscriptionId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFeatureRevision_subscriptionId_version_key" ON "ClientFeatureRevision"("subscriptionId", "version");

-- AddForeignKey
ALTER TABLE "ClientFeatureRevision" ADD CONSTRAINT "ClientFeatureRevision_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
