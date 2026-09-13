-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'CLIENT_ADMIN', 'OPERATIONS_MANAGER', 'FLEET_MANAGER', 'KYC_OPERATOR', 'RIDER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'DEALLOCATION_RIDER', 'DEALLOCATION_OPERATOR', 'PHONE_VERIFICATION');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiderStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PhotoEntityType" AS ENUM ('RIDER', 'FLEET', 'BATTERY', 'CONTROLLER', 'INSPECTION');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING_UPLOAD', 'COMPLETE', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "KycType" AS ENUM ('AADHAAR', 'PAN', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'RETRY_REQUIRED');

-- CreateEnum
CREATE TYPE "FleetStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ALLOCATION_IN_PROGRESS', 'ALLOCATED', 'IN_USE', 'DEALLOCATION_IN_PROGRESS', 'INSPECTION_PENDING', 'MAINTENANCE', 'OUT_OF_SERVICE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING', 'ACTIVE', 'DEALLOCATION_INITIATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('PRE_ALLOCATION', 'POST_DEALLOCATION');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IoTEventType" AS ENUM ('LOCATION', 'HEARTBEAT', 'START', 'STOP');

-- CreateEnum
CREATE TYPE "MasterRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EnergyType" AS ENUM ('ELECTRIC', 'HYBRID', 'PETROL', 'DIESEL', 'CNG', 'HYDROGEN', 'OTHER', 'LPG');

-- CreateEnum
CREATE TYPE "VehicleUsageType" AS ENUM ('PRIVATE', 'PASSENGER', 'GOODS', 'DELIVERY', 'SHARED_MOBILITY', 'PUBLIC_TRANSPORT', 'STAFF_TRANSPORT', 'SCHOOL_TRANSPORT', 'EMERGENCY', 'AGRICULTURAL', 'CONSTRUCTION', 'INDUSTRIAL', 'RENTAL', 'GOVERNMENT', 'SPECIAL_PURPOSE');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FREE', 'INCLUDED', 'FLAT_FEE', 'PER_UNIT', 'TIERED', 'VOLUME', 'PER_USER', 'PER_RIDER', 'PER_VEHICLE', 'PER_FLEET', 'USAGE_BASED', 'PER_DEVICE', 'ONE_TIME', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('ONCE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ClientFeatureSource" AS ENUM ('PACKAGE', 'ADD_ON', 'CUSTOM', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClientContactRole" AS ENUM ('PRIMARY', 'ACCOUNT_ADMIN', 'BILLING');

-- CreateEnum
CREATE TYPE "ClientAddressType" AS ENUM ('REGISTERED', 'BILLING');

-- CreateEnum
CREATE TYPE "ClientDocumentType" AS ENUM ('PAN_CARD', 'GST_CERTIFICATE', 'INCORPORATION_CERTIFICATE', 'FLEET_AGREEMENT', 'BUSINESS_AGREEMENT');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FleetBusinessModel" AS ENUM ('OWNED', 'LEASED', 'ATTACHED', 'MIXED');

-- CreateEnum
CREATE TYPE "VehicleOwnership" AS ENUM ('OWNED', 'LEASED', 'DRIVER_OWNED', 'MIXED');

-- CreateEnum
CREATE TYPE "FeatureCategory" AS ENUM ('LOGIN', 'RIDER_ONBOARDING', 'RIDER_VERIFICATION', 'RIDER_TRAINING', 'RIDER_MANAGEMENT', 'ATTENDANCE', 'FACE_RECOGNITION', 'FLEET_MANAGEMENT', 'VEHICLE_MANAGEMENT', 'IOT_TELEMATICS', 'TRACKING_GEOFENCING', 'BATTERY_MANAGEMENT', 'SERVICE_MAINTENANCE', 'MECHANIC_MANAGEMENT', 'SAFETY_COMPLIANCE', 'ANALYTICS', 'REPORTING', 'NOTIFICATION', 'INTEGRATION', 'API_ACCESS', 'USER_ACCESS', 'DOCUMENT_MANAGEMENT', 'USER_VERIFICATION', 'COUPON', 'TRAINING', 'SUPPORT', 'AI_AUTOMATION');

-- CreateEnum
CREATE TYPE "FeatureType" AS ENUM ('BOOLEAN', 'QUANTITY', 'USAGE_BASED', 'CONFIGURATION');

-- CreateEnum
CREATE TYPE "FeatureBillingUnit" AS ENUM ('VERIFICATION', 'RIDER', 'VEHICLE', 'FLEET', 'USER', 'API_CALL', 'FACE_SCAN', 'TRAINING', 'DEVICE', 'MONTH', 'LIFE_TIME');

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "companyCode" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Oem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "logoUrl" TEXT,
    "logoObjectKey" TEXT,
    "website" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleType" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subCategory" TEXT,
    "description" TEXT,
    "energyType" "EnergyType" NOT NULL,
    "usageType" "VehicleUsageType",
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DECIMAL(12,2),
    "yearlyPrice" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "maxFleets" INTEGER,
    "maxRiders" INTEGER,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FeatureCategory" NOT NULL,
    "featureType" "FeatureType" NOT NULL,
    "billingUnit" "FeatureBillingUnit" NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "includedQuantity" BIGINT,
    "usageLimit" BIGINT,
    "unlimitedUsage" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturePricing" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "pricingModel" "PricingModel" NOT NULL,
    "billingUnit" "FeatureBillingUnit" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "basePrice" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "costPrice" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimumCharge" DECIMAL(12,2),
    "maximumCharge" DECIMAL(12,2),
    "setupFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "billingCycle" "BillingCycle",
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturePricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturePricingTier" (
    "id" TEXT NOT NULL,
    "featurePricingId" TEXT NOT NULL,
    "tierOrder" INTEGER NOT NULL,
    "tierName" VARCHAR(100),
    "fromQuantity" BIGINT NOT NULL,
    "toQuantity" BIGINT,
    "unitPrice" DECIMAL(12,3) NOT NULL,
    "costPrice" DECIMAL(12,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturePricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBusinessProfile" (
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
    "logoObjectKey" TEXT,
    "yearEstablished" INTEGER,
    "estimatedFleetSize" INTEGER,
    "estimatedRiderCount" INTEGER,
    "estimatedUserCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" "ClientContactRole" NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "alternateMobile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAddress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ClientAddressType" NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pinCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOperationsProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetBusinessModel" "FleetBusinessModel" NOT NULL,
    "numberOfFleets" INTEGER NOT NULL,
    "approximateRiderCount" INTEGER NOT NULL,
    "vehicleOwnership" "VehicleOwnership" NOT NULL,
    "primaryVehicleTypeId" TEXT NOT NULL,
    "operationalHubCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOperationsProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBillingProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "billingContactName" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "billingMobile" TEXT,
    "purchaseOrderRequired" BOOLEAN NOT NULL DEFAULT false,
    "poNumber" TEXT,
    "paymentTerms" TEXT,
    "taxApplicable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentType" "ClientDocumentType" NOT NULL,
    "documentNumber" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAgreement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorizedSignatoryName" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "privacyAcceptedAt" TIMESTAMP(3) NOT NULL,
    "dataProcessingConsentAt" TIMESTAMP(3) NOT NULL,
    "kycConsentAt" TIMESTAMP(3),
    "marketingConsentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSubscription" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "listPrice" DECIMAL(14,2) NOT NULL,
    "discountType" VARCHAR(20),
    "discountValue" DECIMAL(14,2),
    "finalPackagePrice" DECIMAL(14,2) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFeature" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "source" "ClientFeatureSource" NOT NULL DEFAULT 'ADD_ON',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includedQuantity" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usageLimit" DECIMAL(14,2),
    "unlimitedUsage" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "configuration" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFeaturePricing" (
    "id" TEXT NOT NULL,
    "clientFeatureId" TEXT NOT NULL,
    "featurePricingId" TEXT NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "listUnitPrice" DECIMAL(14,4) NOT NULL,
    "discountType" VARCHAR(20),
    "discountValue" DECIMAL(14,4),
    "finalUnitPrice" DECIMAL(14,4) NOT NULL,
    "setupFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" VARCHAR(500),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFeaturePricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureUsage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "usageReference" VARCHAR(150),
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "usageTimestamp" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hubId" TEXT,
    "vehicleNumber" TEXT NOT NULL,
    "chassisNumber" TEXT NOT NULL,
    "oem" TEXT,
    "model" TEXT,
    "colour" TEXT,
    "vehicleType" TEXT,
    "motorNumber" TEXT,
    "registrationDate" TIMESTAMP(3),
    "insuranceStartDate" TIMESTAMP(3),
    "insuranceEndDate" TIMESTAMP(3),
    "fitnessRenewalDate" TIMESTAMP(3),
    "status" "FleetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "operationalDetails" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IoTDevice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "deviceNumber" TEXT NOT NULL,
    "ingestSecretHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IoTDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCurrentState" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "speedKph" DECIMAL(6,2),
    "ignition" BOOLEAN,
    "lastHeartbeat" TIMESTAMP(3),
    "lastLocation" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCurrentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" BIGSERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" "IoTEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Battery" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "batteryType" TEXT,
    "capacityWh" INTEGER,
    "manufacturer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Battery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Controller" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "manufacturer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Controller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "mobile" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "address" TEXT,
    "status" "RiderStatus" NOT NULL DEFAULT 'PENDING',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'INITIATED',
    "allocatedAt" TIMESTAMP(3),
    "deallocatedAt" TIMESTAMP(3),
    "initiatedById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "checklist" JSONB,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderKyc" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "type" "KycType" NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT,
    "providerReference" TEXT,
    "maskedData" JSONB,
    "safeFailureCode" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderKyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" "PhotoEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "photoType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoRequirement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" "PhotoEntityType" NOT NULL,
    "photoType" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "clientId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousData" JSONB,
    "newData" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "purpose" "OtpPurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "context" JSONB,
    "status" "OtpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_slug_key" ON "Client"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Client_companyCode_key" ON "Client"("companyCode");

-- CreateIndex
CREATE UNIQUE INDEX "Oem_code_key" ON "Oem"("code");

-- CreateIndex
CREATE INDEX "Oem_status_displayName_idx" ON "Oem"("status", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCategory_code_key" ON "VehicleCategory"("code");

-- CreateIndex
CREATE INDEX "VehicleCategory_status_displayOrder_name_idx" ON "VehicleCategory"("status", "displayOrder", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleType_code_key" ON "VehicleType"("code");

-- CreateIndex
CREATE INDEX "VehicleType_categoryId_status_name_idx" ON "VehicleType"("categoryId", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Package_code_key" ON "Package"("code");

-- CreateIndex
CREATE INDEX "Package_isActive_isCustom_displayOrder_idx" ON "Package"("isActive", "isCustom", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_code_key" ON "Feature"("code");

-- CreateIndex
CREATE INDEX "Feature_isActive_category_displayOrder_idx" ON "Feature"("isActive", "category", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PackageFeature_packageId_featureId_key" ON "PackageFeature"("packageId", "featureId");

-- CreateIndex
CREATE INDEX "FeaturePricing_featureId_isActive_effectiveFrom_idx" ON "FeaturePricing"("featureId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturePricingTier_featurePricingId_tierOrder_key" ON "FeaturePricingTier"("featurePricingId", "tierOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBusinessProfile_clientId_key" ON "ClientBusinessProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_role_idx" ON "ClientContact"("clientId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClientContact_clientId_role_key" ON "ClientContact"("clientId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAddress_clientId_type_key" ON "ClientAddress"("clientId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOperationsProfile_clientId_key" ON "ClientOperationsProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientOperationsProfile_primaryVehicleTypeId_idx" ON "ClientOperationsProfile"("primaryVehicleTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBillingProfile_clientId_key" ON "ClientBillingProfile"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDocument_objectKey_key" ON "ClientDocument"("objectKey");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_documentType_verificationStatus_idx" ON "ClientDocument"("clientId", "documentType", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAgreement_clientId_key" ON "ClientAgreement"("clientId");

-- CreateIndex
CREATE INDEX "ClientSubscription_clientId_status_idx" ON "ClientSubscription"("clientId", "status");

-- CreateIndex
CREATE INDEX "ClientFeature_clientId_enabled_idx" ON "ClientFeature"("clientId", "enabled");

-- CreateIndex
CREATE INDEX "ClientFeature_featureId_enabled_idx" ON "ClientFeature"("featureId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFeature_subscriptionId_featureId_key" ON "ClientFeature"("subscriptionId", "featureId");

-- CreateIndex
CREATE INDEX "ClientFeaturePricing_clientFeatureId_effectiveFrom_idx" ON "ClientFeaturePricing"("clientFeatureId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ClientFeaturePricing_featurePricingId_effectiveFrom_idx" ON "ClientFeaturePricing"("featurePricingId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "FeatureUsage_subscriptionId_featureId_usageTimestamp_idx" ON "FeatureUsage"("subscriptionId", "featureId", "usageTimestamp");

-- CreateIndex
CREATE INDEX "FeatureUsage_clientId_usageTimestamp_idx" ON "FeatureUsage"("clientId", "usageTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Hub_clientId_code_key" ON "Hub"("clientId", "code");

-- CreateIndex
CREATE INDEX "Fleet_clientId_status_idx" ON "Fleet"("clientId", "status");

-- CreateIndex
CREATE INDEX "Fleet_clientId_hubId_idx" ON "Fleet"("clientId", "hubId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_insuranceEndDate_idx" ON "Fleet"("clientId", "insuranceEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_vehicleNumber_key" ON "Fleet"("clientId", "vehicleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_chassisNumber_key" ON "Fleet"("clientId", "chassisNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IoTDevice_fleetId_key" ON "IoTDevice"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "IoTDevice_clientId_deviceNumber_key" ON "IoTDevice"("clientId", "deviceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_fleetId_key" ON "VehicleCurrentState"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_deviceId_key" ON "VehicleCurrentState"("deviceId");

-- CreateIndex
CREATE INDEX "VehicleCurrentState_clientId_lastHeartbeat_idx" ON "VehicleCurrentState"("clientId", "lastHeartbeat");

-- CreateIndex
CREATE INDEX "TelemetryEvent_clientId_fleetId_occurredAt_idx" ON "TelemetryEvent"("clientId", "fleetId", "occurredAt");

-- CreateIndex
CREATE INDEX "Battery_clientId_fleetId_idx" ON "Battery"("clientId", "fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_clientId_serialNumber_key" ON "Battery"("clientId", "serialNumber");

-- CreateIndex
CREATE INDEX "Controller_clientId_fleetId_idx" ON "Controller"("clientId", "fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "Controller_clientId_serialNumber_key" ON "Controller"("clientId", "serialNumber");

-- CreateIndex
CREATE INDEX "User_clientId_role_isActive_idx" ON "User"("clientId", "role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_mobile_key" ON "User"("clientId", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_userId_key" ON "Rider"("userId");

-- CreateIndex
CREATE INDEX "Rider_clientId_status_idx" ON "Rider"("clientId", "status");

-- CreateIndex
CREATE INDEX "Rider_clientId_name_idx" ON "Rider"("clientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_clientId_mobile_key" ON "Rider"("clientId", "mobile");

-- CreateIndex
CREATE INDEX "Allocation_clientId_fleetId_status_idx" ON "Allocation"("clientId", "fleetId", "status");

-- CreateIndex
CREATE INDEX "Allocation_clientId_riderId_status_idx" ON "Allocation"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_clientId_idempotencyKey_key" ON "Allocation"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Inspection_clientId_status_idx" ON "Inspection"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_allocationId_type_key" ON "Inspection"("allocationId", "type");

-- CreateIndex
CREATE INDEX "RiderKyc_clientId_status_idx" ON "RiderKyc"("clientId", "status");

-- CreateIndex
CREATE INDEX "RiderKyc_provider_providerReference_idx" ON "RiderKyc"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "RiderKyc_riderId_type_key" ON "RiderKyc"("riderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_objectKey_key" ON "Photo"("objectKey");

-- CreateIndex
CREATE INDEX "Photo_clientId_entityType_entityId_idx" ON "Photo"("clientId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Photo_clientId_status_idx" ON "Photo"("clientId", "status");

-- CreateIndex
CREATE INDEX "PhotoRequirement_clientId_entityType_sortOrder_idx" ON "PhotoRequirement"("clientId", "entityType", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoRequirement_clientId_entityType_photoType_key" ON "PhotoRequirement"("clientId", "entityType", "photoType");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_clientId_entityType_entityId_createdAt_idx" ON "AuditLog"("clientId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_clientId_action_createdAt_idx" ON "AuditLog"("clientId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequest_phone_purpose_createdAt_idx" ON "OtpRequest"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequest_clientId_status_idx" ON "OtpRequest"("clientId", "status");

-- AddForeignKey
ALTER TABLE "VehicleType" ADD CONSTRAINT "VehicleType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturePricing" ADD CONSTRAINT "FeaturePricing_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturePricingTier" ADD CONSTRAINT "FeaturePricingTier_featurePricingId_fkey" FOREIGN KEY ("featurePricingId") REFERENCES "FeaturePricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBusinessProfile" ADD CONSTRAINT "ClientBusinessProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsProfile" ADD CONSTRAINT "ClientOperationsProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsProfile" ADD CONSTRAINT "ClientOperationsProfile_primaryVehicleTypeId_fkey" FOREIGN KEY ("primaryVehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBillingProfile" ADD CONSTRAINT "ClientBillingProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeature" ADD CONSTRAINT "ClientFeature_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeature" ADD CONSTRAINT "ClientFeature_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeature" ADD CONSTRAINT "ClientFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeaturePricing" ADD CONSTRAINT "ClientFeaturePricing_clientFeatureId_fkey" FOREIGN KEY ("clientFeatureId") REFERENCES "ClientFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeaturePricing" ADD CONSTRAINT "ClientFeaturePricing_featurePricingId_fkey" FOREIGN KEY ("featurePricingId") REFERENCES "FeaturePricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsage" ADD CONSTRAINT "FeatureUsage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsage" ADD CONSTRAINT "FeatureUsage_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsage" ADD CONSTRAINT "FeatureUsage_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IoTDevice" ADD CONSTRAINT "IoTDevice_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Controller" ADD CONSTRAINT "Controller_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderKyc" ADD CONSTRAINT "RiderKyc_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
