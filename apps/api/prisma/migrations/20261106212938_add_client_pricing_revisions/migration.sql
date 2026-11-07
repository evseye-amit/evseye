-- CreateTable
CREATE TABLE "ClientPricingRevision" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "setupDiscountPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "vehicleDiscountPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPricingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPricingRevision_subscriptionId_publishedAt_idx" ON "ClientPricingRevision"("subscriptionId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPricingRevision_subscriptionId_version_key" ON "ClientPricingRevision"("subscriptionId", "version");

-- AddForeignKey
ALTER TABLE "ClientPricingRevision" ADD CONSTRAINT "ClientPricingRevision_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
