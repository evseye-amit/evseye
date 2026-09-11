-- CreateEnum
CREATE TYPE "OemType" AS ENUM ('VEHICLE', 'BATTERY', 'IOT', 'CHARGER', 'MULTI_PRODUCT');

-- CreateEnum
CREATE TYPE "MasterRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('INCLUDED', 'PER_UNIT', 'PER_RIDER', 'PER_VEHICLE_DEVICE', 'TIERED_VOLUME', 'FLAT_FEE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateTable
CREATE TABLE "Oem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "type" "OemType" NOT NULL,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "logoUrl" TEXT,
    "website" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DECIMAL(12,2) NOT NULL,
    "yearlyPrice" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "featureType" TEXT NOT NULL,
    "billingUnit" TEXT NOT NULL,
    "description" TEXT,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageFeature" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includedQuantity" INTEGER,
    "usageLimit" INTEGER,
    "unlimitedUsage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturePricing" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "pricingModel" "PricingModel" NOT NULL,
    "billingUnit" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2),
    "minCharge" DECIMAL(12,2),
    "maxCharge" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturePricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "legalCompanyName" TEXT NOT NULL,
    "clientType" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "industry" TEXT,
    "gstin" TEXT,
    "pan" TEXT NOT NULL,
    "cinOrLlpin" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "primaryContactName" TEXT NOT NULL,
    "primaryContactTitle" TEXT NOT NULL,
    "primaryContactMobile" TEXT NOT NULL,
    "primaryContactEmail" TEXT NOT NULL,
    "alternateMobile" TEXT,
    "registeredAddressLine1" TEXT NOT NULL,
    "registeredAddressLine2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pinCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSubscription" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "packageStartDate" TIMESTAMP(3) NOT NULL,
    "trialApplicable" BOOLEAN NOT NULL DEFAULT false,
    "trialDays" INTEGER,
    "billingFrequency" TEXT NOT NULL,
    "basePackagePrice" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "discountType" TEXT,
    "discount" DECIMAL(12,2),
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "autoRenewal" BOOLEAN NOT NULL DEFAULT true,
    "paymentTerms" TEXT,
    "poNumber" TEXT,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Oem_code_key" ON "Oem"("code");

-- CreateIndex
CREATE INDEX "Oem_status_type_idx" ON "Oem"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Package_code_key" ON "Package"("code");

-- CreateIndex
CREATE INDEX "Package_status_idx" ON "Package"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_code_key" ON "Feature"("code");

-- CreateIndex
CREATE INDEX "Feature_status_category_idx" ON "Feature"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PackageFeature_packageId_featureId_key" ON "PackageFeature"("packageId", "featureId");

-- CreateIndex
CREATE INDEX "FeaturePricing_featureId_isActive_effectiveFrom_idx" ON "FeaturePricing"("featureId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_clientId_key" ON "ClientProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientSubscription_clientId_status_idx" ON "ClientSubscription"("clientId", "status");

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturePricing" ADD CONSTRAINT "FeaturePricing_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
