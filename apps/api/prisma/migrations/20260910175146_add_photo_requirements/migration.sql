-- CreateTable
CREATE TABLE "PhotoRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" "PhotoEntityType" NOT NULL,
    "photoType" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoRequirement_tenantId_entityType_sortOrder_idx" ON "PhotoRequirement"("tenantId", "entityType", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoRequirement_tenantId_entityType_photoType_key" ON "PhotoRequirement"("tenantId", "entityType", "photoType");
