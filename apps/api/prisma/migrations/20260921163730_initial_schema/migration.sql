-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'CLIENT_ADMIN', 'OPERATIONS_MANAGER', 'FLEET_MANAGER', 'TEAM_LEAD', 'KYC_OPERATOR', 'RIDER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'DEALLOCATION_RIDER', 'DEALLOCATION_OPERATOR', 'PHONE_VERIFICATION');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiderStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'INACTIVE', 'BLOCKED', 'EXITED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "HubType" AS ENUM ('OPERATIONS', 'PARKING', 'CHARGING', 'BATTERY_SWAP', 'MAINTENANCE', 'WAREHOUSE', 'DELIVERY', 'MIXED');

-- CreateEnum
CREATE TYPE "HubStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TEMPORARILY_CLOSED', 'UNDER_MAINTENANCE', 'FULL');

-- CreateEnum
CREATE TYPE "ClientOnboardingStep" AS ENUM ('HUBS', 'FLEET_MANAGERS', 'TEAM_LEADERS', 'FLEETS', 'RIDERS', 'REVIEW');

-- CreateEnum
CREATE TYPE "ClientOnboardingStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('HUB', 'FLEET_MANAGER', 'TEAM_LEADER', 'FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE', 'FLEET_COMPONENT_MAPPING', 'RIDER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PASS', 'PARTIAL_PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "PhotoEntityType" AS ENUM ('RIDER', 'FLEET', 'BATTERY', 'CONTROLLER', 'IOT_DEVICE', 'INSPECTION', 'RIDER_ONBOARDING');

-- CreateEnum
CREATE TYPE "RiderDocumentReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING_UPLOAD', 'COMPLETE', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "KycType" AS ENUM ('AADHAAR', 'PAN', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'RETRY_REQUIRED');

-- CreateEnum
CREATE TYPE "FleetStatus" AS ENUM ('IN_TRANSIT', 'AVAILABLE', 'RESERVED', 'ALLOCATION_IN_PROGRESS', 'ALLOCATED', 'IN_USE', 'DEALLOCATION_IN_PROGRESS', 'INSPECTION_PENDING', 'MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "FleetOnboardingStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VehicleSpeedType" AS ENUM ('SLOW_SPEED', 'HIGH_SPEED');

-- CreateEnum
CREATE TYPE "FleetOwnershipType" AS ENUM ('CLIENT_OWNED', 'LEASED', 'ATTACHED', 'OEM_OWNED', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "BatteryType" AS ENUM ('FIXED_SINGLE', 'FIXED_DOUBLE', 'SWAP_IF', 'SWAP_BS', 'SWAP_MOVING', 'SWAP_OTHER');

-- CreateEnum
CREATE TYPE "BatteryStatus" AS ENUM ('AVAILABLE', 'INSTALLED', 'CHARGING', 'IN_SWAP', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "BatteryChemistry" AS ENUM ('LFP', 'NMC', 'LTO', 'LEAD_ACID', 'OTHER');

-- CreateEnum
CREATE TYPE "BatterySlot" AS ENUM ('PRIMARY', 'SECONDARY', 'AUXILIARY');

-- CreateEnum
CREATE TYPE "ControllerStatus" AS ENUM ('AVAILABLE', 'INSTALLED', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "InsuranceType" AS ENUM ('THIRD_PARTY', 'COMPREHENSIVE', 'OWN_DAMAGE');

-- CreateEnum
CREATE TYPE "FleetDocumentType" AS ENUM ('RC', 'INSURANCE', 'FITNESS_CERTIFICATE', 'PERMIT', 'PUC', 'INVOICE', 'WARRANTY', 'OTHER');

-- CreateEnum
CREATE TYPE "IoTDeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OFFLINE', 'DAMAGED', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "FleetTransferStatus" AS ENUM ('INITIATED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING', 'ACTIVE', 'DEALLOCATION_INITIATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('PRE_ALLOCATION', 'POST_DEALLOCATION');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MobileDeploymentStatus" AS ENUM ('RIDER_WAITING', 'FLEET_REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_PAID', 'PDI_PENDING_RIDER', 'TRAINING_PENDING', 'DEVICE_PAIRING_PENDING', 'DEPLOYED');

-- CreateEnum
CREATE TYPE "DeploymentPaymentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IoTEventType" AS ENUM ('LOCATION', 'HEARTBEAT', 'START', 'STOP');

-- CreateEnum
CREATE TYPE "MasterRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EnergyType" AS ENUM ('ELECTRIC', 'HYBRID', 'PETROL', 'DIESEL', 'CNG', 'HYDROGEN', 'OTHER', 'LPG');

-- CreateEnum
CREATE TYPE "VehicleUsageType" AS ENUM ('PRIVATE', 'PASSENGER', 'GOODS', 'DELIVERY', 'SHARED_MOBILITY', 'PUBLIC_TRANSPORT', 'STAFF_TRANSPORT', 'SCHOOL_TRANSPORT', 'EMERGENCY', 'AGRICULTURAL', 'CONSTRUCTION', 'INDUSTRIAL', 'RENTAL', 'GOVERNMENT', 'SPECIAL_PURPOSE');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('ONCE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PricingTierMode" AS ENUM ('VOLUME', 'GRADUATED');

-- CreateEnum
CREATE TYPE "AllowanceResetPeriod" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ClientSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PricingAdjustmentScope" AS ENUM ('SETUP_FEE', 'PACKAGE', 'FEATURE', 'FEATURE_ADDON', 'TOTAL_INVOICE');

-- CreateEnum
CREATE TYPE "PricingAdjustmentType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'OVERRIDE_PRICE');

-- CreateEnum
CREATE TYPE "FeatureAddOnPurchaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeatureCreditSourceType" AS ENUM ('PACKAGE_ALLOWANCE', 'FEATURE_ADDON', 'MANUAL_ADJUSTMENT', 'PROMOTIONAL_CREDIT');

-- CreateEnum
CREATE TYPE "FeatureUsageTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'EXPIRE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ClientFeatureSource" AS ENUM ('PACKAGE', 'ADD_ON', 'CUSTOM', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('DRAFT', 'CREATED', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED');

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
CREATE TYPE "ClientIndustry" AS ENUM ('LOGISTICS', 'LAST_MILE', 'DELIVERY', 'MOBILITY', 'RENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FeatureCategory" AS ENUM ('LOGIN', 'RIDER_ONBOARDING', 'RIDER_VERIFICATION', 'RIDER_TRAINING', 'RIDER_MANAGEMENT', 'ATTENDANCE', 'FACE_RECOGNITION', 'FLEET_MANAGEMENT', 'VEHICLE_MANAGEMENT', 'IOT_TELEMATICS', 'TRACKING_GEOFENCING', 'BATTERY_MANAGEMENT', 'SERVICE_MAINTENANCE', 'MECHANIC_MANAGEMENT', 'SAFETY_COMPLIANCE', 'ANALYTICS', 'REPORTING', 'NOTIFICATION', 'INTEGRATION', 'API_ACCESS', 'USER_ACCESS', 'DOCUMENT_MANAGEMENT', 'USER_VERIFICATION', 'COUPON', 'TRAINING', 'SUPPORT', 'AI_AUTOMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "FeatureType" AS ENUM ('BOOLEAN', 'QUANTITY', 'USAGE_BASED', 'CONFIGURATION');

-- CreateEnum
CREATE TYPE "FeatureBillingUnit" AS ENUM ('SMS', 'EMAIL', 'UPLOAD', 'WHATSAPP_MESSAGE', 'VERIFICATION', 'RIDER', 'VEHICLE', 'FLEET', 'USER', 'API_CALL', 'FACE_SCAN', 'TRAINING', 'DEVICE', 'GB', 'MONTH', 'AI_CREDIT', 'LIFE_TIME');

-- CreateEnum
CREATE TYPE "ClientDomainType" AS ENUM ('EVSEYE_SUBDOMAIN', 'CUSTOM_DOMAIN');

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
    "setupFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "maxFleets" INTEGER NOT NULL DEFAULT 2147483647,
    "maxRiders" INTEGER NOT NULL DEFAULT 2147483647,
    "maxAdmins" INTEGER NOT NULL DEFAULT 2147483647,
    "maxFleetManagers" INTEGER NOT NULL DEFAULT 2147483647,
    "maxHubs" INTEGER NOT NULL DEFAULT 2147483647,
    "maxTeamLeaders" INTEGER NOT NULL DEFAULT 2147483647,
    "maxClusterManagers" INTEGER NOT NULL DEFAULT 2147483647,
    "maxUsers" INTEGER NOT NULL DEFAULT 2147483647,
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
    "category" "FeatureCategory" DEFAULT 'OTHER',
    "featureType" "FeatureType" NOT NULL,
    "billingUnit" "FeatureBillingUnit" NOT NULL,
    "description" TEXT,
    "configuration" JSONB,
    "featureStepId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureStep" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageFeature" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "includedQuantity" DECIMAL(18,4),
    "resetPeriod" "AllowanceResetPeriod" NOT NULL DEFAULT 'NONE',
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "rolloverAllowed" BOOLEAN NOT NULL DEFAULT false,
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
    "billingUnit" "FeatureBillingUnit" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "salePrice" DECIMAL(14,4) NOT NULL,
    "costPrice" DECIMAL(14,4),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturePricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageVehicleTierPricing" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "minVehicles" INTEGER NOT NULL,
    "maxVehicles" INTEGER,
    "pricePerVehicle" DECIMAL(14,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "billingPeriod" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "tierMode" "PricingTierMode" NOT NULL DEFAULT 'VOLUME',
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageVehicleTierPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureAddOn" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "featureId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "costPrice" DECIMAL(14,4),
    "salePrice" DECIMAL(14,4) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "validityDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingContent" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageObjectKey" VARCHAR(500) NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageFeatureAddOn" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "featureAddOnId" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageFeatureAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBusinessProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "legalCompanyName" TEXT NOT NULL,
    "clientType" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "industry" "ClientIndustry",
    "gstin" TEXT,
    "pan" TEXT NOT NULL,
    "cinOrLlpin" TEXT,
    "website" TEXT,
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
    "operationalHubCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOperationsProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOperationsVehicleCategory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "operationsProfileId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOperationsVehicleCategory_pkey" PRIMARY KEY ("id")
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
    "status" "ClientSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "vehicleCount" INTEGER NOT NULL DEFAULT 0,
    "setupFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pricePerVehicle" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "recurringAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tierMinVehicles" INTEGER NOT NULL DEFAULT 0,
    "tierMaxVehicles" INTEGER,
    "tierMode" "PricingTierMode" NOT NULL DEFAULT 'VOLUME',
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPricingAdjustment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "adjustmentScope" "PricingAdjustmentScope" NOT NULL,
    "referenceId" TEXT,
    "adjustmentType" "PricingAdjustmentType" NOT NULL,
    "adjustmentValue" DECIMAL(14,4) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPricingAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFeatureAddOnPurchase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureAddOnId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "quantityPurchased" DECIMAL(18,4) NOT NULL,
    "quantityConsumed" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityRemaining" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validFrom" DATE NOT NULL,
    "expiresAt" DATE,
    "status" "FeatureAddOnPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFeatureAddOnPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureCreditLot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "sourceType" "FeatureCreditSourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "purchaseId" TEXT,
    "quantityOriginal" DECIMAL(18,4) NOT NULL,
    "quantityAvailable" DECIMAL(18,4) NOT NULL,
    "expiresAt" DATE,
    "periodStart" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureCreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureUsageLedger" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "creditLotId" TEXT,
    "sourceType" "FeatureCreditSourceType" NOT NULL,
    "sourceId" TEXT,
    "transactionType" "FeatureUsageTransactionType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4),
    "referenceType" VARCHAR(100),
    "referenceId" VARCHAR(150),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATE,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureUsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" "HubType" NOT NULL DEFAULT 'OPERATIONS',
    "status" "HubStatus" NOT NULL DEFAULT 'ACTIVE',
    "addressLine1" VARCHAR(255),
    "addressLine2" VARCHAR(255),
    "landmark" VARCHAR(150),
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "district" VARCHAR(100),
    "state" VARCHAR(100) NOT NULL DEFAULT '',
    "country" VARCHAR(100) NOT NULL DEFAULT 'India',
    "postalCode" VARCHAR(10),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "parentHubId" TEXT,
    "vehicleCapacity" INTEGER,
    "riderCapacity" INTEGER,
    "batteryCapacity" INTEGER,
    "parkingSlots" INTEGER,
    "chargingPoints" INTEGER,
    "swappingPoints" INTEGER,
    "contactName" VARCHAR(150),
    "contactPhone" VARCHAR(20),
    "contactEmail" VARCHAR(150),
    "openingTime" VARCHAR(5),
    "closingTime" VARCHAR(5),
    "is24x7" BOOLEAN NOT NULL DEFAULT false,
    "supportsCharging" BOOLEAN NOT NULL DEFAULT false,
    "supportsBatterySwapping" BOOLEAN NOT NULL DEFAULT false,
    "supportsMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "supportsAllocation" BOOLEAN NOT NULL DEFAULT true,
    "supportsDeallocation" BOOLEAN NOT NULL DEFAULT true,
    "supportsPdi" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetCode" VARCHAR(50) NOT NULL,
    "vehicleNumber" VARCHAR(30),
    "chassisNumber" VARCHAR(100) NOT NULL,
    "vinNumber" VARCHAR(100),
    "oemId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "vehicleTypeId" TEXT NOT NULL,
    "speedType" "VehicleSpeedType" NOT NULL,
    "modelName" VARCHAR(100),
    "variantName" VARCHAR(100),
    "colour" VARCHAR(50),
    "manufacturingYear" INTEGER,
    "manufacturingMonth" INTEGER,
    "motorNumber" VARCHAR(100),
    "ownershipType" "FleetOwnershipType" NOT NULL DEFAULT 'CLIENT_OWNED',
    "status" "FleetStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "allocationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "homeHubId" TEXT,
    "currentHubId" TEXT,
    "odometerKm" DECIMAL(12,2),
    "iotDeviceId" TEXT,
    "onboardingStatus" "FleetOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "onboardedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetRegistration" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "registrationDate" DATE,
    "registeringAuthority" VARCHAR(150),
    "rcExpiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetInsurance" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "providerName" VARCHAR(150),
    "policyNumber" VARCHAR(100),
    "insuranceType" "InsuranceType",
    "startDate" DATE,
    "endDate" DATE,
    "idv" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetFitness" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "certificateNumber" VARCHAR(100),
    "issueDate" DATE,
    "expiryDate" DATE,
    "renewalDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetFitness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetDocument" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "type" "FleetDocumentType" NOT NULL,
    "documentNumber" VARCHAR(100),
    "objectKey" VARCHAR(500) NOT NULL,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IoTDevice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deviceNumber" VARCHAR(100) NOT NULL,
    "imei" VARCHAR(30),
    "simNumber" VARCHAR(30),
    "iccid" VARCHAR(30),
    "provider" VARCHAR(100),
    "model" VARCHAR(100),
    "ingestSecretHash" TEXT NOT NULL,
    "status" "IoTDeviceStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "installedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastLocationAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IoTDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCurrentState" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "iotDeviceId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "speedKph" DECIMAL(8,2),
    "ignition" BOOLEAN,
    "batterySoc" INTEGER,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastLocationAt" TIMESTAMP(3),
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
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
    "batteryCode" VARCHAR(50),
    "serialNumber" VARCHAR(100) NOT NULL,
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "chemistry" "BatteryChemistry",
    "capacityKwh" DECIMAL(8,3),
    "voltage" DECIMAL(8,2),
    "ampHour" DECIMAL(8,2),
    "batteryType" "BatteryType" NOT NULL,
    "status" "BatteryStatus" NOT NULL DEFAULT 'AVAILABLE',
    "manufacturingDate" DATE,
    "warrantyStartDate" DATE,
    "warrantyEndDate" DATE,
    "currentSoc" INTEGER,
    "currentSoh" INTEGER,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Battery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetBatteryHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "batteryId" TEXT NOT NULL,
    "batterySlot" "BatterySlot" NOT NULL DEFAULT 'PRIMARY',
    "installedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "installedOdometerKm" DECIMAL(12,2),
    "removedOdometerKm" DECIMAL(12,2),
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetBatteryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Controller" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "controllerNumber" VARCHAR(100) NOT NULL,
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "ratedVoltage" DECIMAL(8,2),
    "ratedCurrent" DECIMAL(8,2),
    "status" "ControllerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Controller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetControllerHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetControllerHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetStatusHistory" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "fromStatus" "FleetStatus",
    "toStatus" "FleetStatus" NOT NULL,
    "changedByUserId" TEXT,
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetTransfer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "fromHubId" TEXT,
    "toHubId" TEXT NOT NULL,
    "status" "FleetTransferStatus" NOT NULL DEFAULT 'INITIATED',
    "initiatedById" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "mobile" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
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
    "riderCode" VARCHAR(50),
    "dateOfBirth" DATE,
    "gender" "Gender",
    "addressLine1" VARCHAR(255),
    "addressLine2" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postalCode" VARCHAR(10),
    "emergencyContactName" VARCHAR(150),
    "emergencyContactMobile" VARCHAR(20),
    "status" "RiderStatus" NOT NULL DEFAULT 'ONBOARDING',
    "joiningDate" DATE,
    "exitDate" DATE,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderOnboardingProgress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "completedStepIds" JSONB NOT NULL DEFAULT '[]',
    "skippedStepIds" JSONB NOT NULL DEFAULT '[]',
    "values" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderOnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserHub" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeaderProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" VARCHAR(50),
    "designation" VARCHAR(100),
    "joiningDate" DATE,
    "leavingDate" DATE,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TeamLeaderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamLeaderRider" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "teamLeaderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamLeaderRider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOnboardingProgress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currentStep" "ClientOnboardingStep" NOT NULL DEFAULT 'HUBS',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOnboardingStepRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "step" "ClientOnboardingStep" NOT NULL,
    "status" "ClientOnboardingStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "savedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingStepRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" "ImportEntityType" NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "passedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "failureReportKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "MobileDeploymentWorkflow" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "status" "MobileDeploymentStatus" NOT NULL DEFAULT 'RIDER_WAITING',
    "paymentBreakdown" JSONB,
    "paymentPaidAt" TIMESTAMP(3),
    "pdiChecklist" JSONB,
    "workPartnerName" TEXT,
    "riderPdiAcceptedAt" TIMESTAMP(3),
    "riderPdiRemarksText" TEXT,
    "riderPdiVoicePhotoId" TEXT,
    "trainingViewedContentCodes" JSONB NOT NULL DEFAULT '[]',
    "trainingCompletedAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "pairingBypassedAt" TIMESTAMP(3),
    "pairingBypassedById" TEXT,
    "pairingBypassReason" TEXT,
    "pairingHealthSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileDeploymentWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentPayment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "DeploymentPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "amount" DECIMAL(14,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "provider" TEXT,
    "providerReference" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentPayment_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "RiderOnboardingDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "riderId" TEXT,
    "featureId" TEXT NOT NULL,
    "fieldCode" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "status" "RiderDocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderOnboardingDocument_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "ClientDomain" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "type" "ClientDomainType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBranding" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "logoObjectKey" TEXT,
    "faviconObjectKey" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#176b4c',
    "secondaryColor" TEXT NOT NULL DEFAULT '#e4f2e9',
    "accentColor" TEXT NOT NULL DEFAULT '#27865f',
    "loginTitle" TEXT NOT NULL DEFAULT 'Welcome back',
    "loginSubtitle" TEXT NOT NULL DEFAULT 'Sign in to your EV fleet workspace.',
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBranding_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "Feature_featureStepId_idx" ON "Feature"("featureStepId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureStep_code_key" ON "FeatureStep"("code");

-- CreateIndex
CREATE INDEX "FeatureStep_parentId_isActive_displayOrder_idx" ON "FeatureStep"("parentId", "isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PackageFeature_packageId_featureId_key" ON "PackageFeature"("packageId", "featureId");

-- CreateIndex
CREATE INDEX "FeaturePricing_featureId_isActive_effectiveFrom_idx" ON "FeaturePricing"("featureId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PackageVehicleTierPricing_packageId_isActive_effectiveFrom_idx" ON "PackageVehicleTierPricing"("packageId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PackageVehicleTierPricing_packageId_minVehicles_effectiveFr_key" ON "PackageVehicleTierPricing"("packageId", "minVehicles", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureAddOn_code_key" ON "FeatureAddOn"("code");

-- CreateIndex
CREATE INDEX "FeatureAddOn_featureId_isActive_effectiveFrom_idx" ON "FeatureAddOn"("featureId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingContent_code_key" ON "TrainingContent"("code");

-- CreateIndex
CREATE INDEX "TrainingContent_featureId_isActive_displayOrder_idx" ON "TrainingContent"("featureId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "PackageFeatureAddOn_featureAddOnId_isAvailable_idx" ON "PackageFeatureAddOn"("featureAddOnId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "PackageFeatureAddOn_packageId_featureAddOnId_key" ON "PackageFeatureAddOn"("packageId", "featureAddOnId");

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
CREATE INDEX "ClientOperationsVehicleCategory_clientId_vehicleCategoryId_idx" ON "ClientOperationsVehicleCategory"("clientId", "vehicleCategoryId");

-- CreateIndex
CREATE INDEX "ClientOperationsVehicleCategory_vehicleCategoryId_idx" ON "ClientOperationsVehicleCategory"("vehicleCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOperationsVehicleCategory_operationsProfileId_vehicle_key" ON "ClientOperationsVehicleCategory"("operationsProfileId", "vehicleCategoryId");

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
CREATE INDEX "ClientPricingAdjustment_clientId_adjustmentScope_isActive_v_idx" ON "ClientPricingAdjustment"("clientId", "adjustmentScope", "isActive", "validFrom");

-- CreateIndex
CREATE INDEX "ClientPricingAdjustment_subscriptionId_isActive_validFrom_idx" ON "ClientPricingAdjustment"("subscriptionId", "isActive", "validFrom");

-- CreateIndex
CREATE INDEX "ClientFeatureAddOnPurchase_clientId_featureId_status_expire_idx" ON "ClientFeatureAddOnPurchase"("clientId", "featureId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ClientFeatureAddOnPurchase_subscriptionId_status_idx" ON "ClientFeatureAddOnPurchase"("subscriptionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureCreditLot_sourceKey_key" ON "FeatureCreditLot"("sourceKey");

-- CreateIndex
CREATE INDEX "FeatureCreditLot_clientId_featureId_quantityAvailable_expir_idx" ON "FeatureCreditLot"("clientId", "featureId", "quantityAvailable", "expiresAt");

-- CreateIndex
CREATE INDEX "FeatureCreditLot_subscriptionId_featureId_periodStart_idx" ON "FeatureCreditLot"("subscriptionId", "featureId", "periodStart");

-- CreateIndex
CREATE INDEX "FeatureUsageLedger_clientId_featureId_occurredAt_idx" ON "FeatureUsageLedger"("clientId", "featureId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeatureUsageLedger_subscriptionId_featureId_occurredAt_idx" ON "FeatureUsageLedger"("subscriptionId", "featureId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeatureUsageLedger_creditLotId_occurredAt_idx" ON "FeatureUsageLedger"("creditLotId", "occurredAt");

-- CreateIndex
CREATE INDEX "Hub_clientId_status_idx" ON "Hub"("clientId", "status");

-- CreateIndex
CREATE INDEX "Hub_clientId_city_idx" ON "Hub"("clientId", "city");

-- CreateIndex
CREATE INDEX "Hub_parentHubId_idx" ON "Hub"("parentHubId");

-- CreateIndex
CREATE UNIQUE INDEX "Hub_clientId_code_key" ON "Hub"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_iotDeviceId_key" ON "Fleet"("iotDeviceId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_status_idx" ON "Fleet"("clientId", "status");

-- CreateIndex
CREATE INDEX "Fleet_clientId_oemId_idx" ON "Fleet"("clientId", "oemId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_vehicleCategoryId_idx" ON "Fleet"("clientId", "vehicleCategoryId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_vehicleTypeId_idx" ON "Fleet"("clientId", "vehicleTypeId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_speedType_idx" ON "Fleet"("clientId", "speedType");

-- CreateIndex
CREATE INDEX "Fleet_clientId_currentHubId_idx" ON "Fleet"("clientId", "currentHubId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_homeHubId_idx" ON "Fleet"("clientId", "homeHubId");

-- CreateIndex
CREATE INDEX "Fleet_clientId_onboardingStatus_idx" ON "Fleet"("clientId", "onboardingStatus");

-- CreateIndex
CREATE INDEX "Fleet_clientId_allocationEnabled_idx" ON "Fleet"("clientId", "allocationEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_fleetCode_key" ON "Fleet"("clientId", "fleetCode");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_vehicleNumber_key" ON "Fleet"("clientId", "vehicleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_chassisNumber_key" ON "Fleet"("clientId", "chassisNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_clientId_vinNumber_key" ON "Fleet"("clientId", "vinNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FleetRegistration_fleetId_key" ON "FleetRegistration"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetInsurance_fleetId_key" ON "FleetInsurance"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetFitness_fleetId_key" ON "FleetFitness"("fleetId");

-- CreateIndex
CREATE INDEX "FleetDocument_fleetId_type_idx" ON "FleetDocument"("fleetId", "type");

-- CreateIndex
CREATE INDEX "FleetDocument_expiresAt_idx" ON "FleetDocument"("expiresAt");

-- CreateIndex
CREATE INDEX "IoTDevice_clientId_status_idx" ON "IoTDevice"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IoTDevice_clientId_deviceNumber_key" ON "IoTDevice"("clientId", "deviceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_fleetId_key" ON "VehicleCurrentState"("fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCurrentState_iotDeviceId_key" ON "VehicleCurrentState"("iotDeviceId");

-- CreateIndex
CREATE INDEX "VehicleCurrentState_clientId_lastHeartbeatAt_idx" ON "VehicleCurrentState"("clientId", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_clientId_fleetId_occurredAt_idx" ON "TelemetryEvent"("clientId", "fleetId", "occurredAt");

-- CreateIndex
CREATE INDEX "Battery_clientId_status_idx" ON "Battery"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_clientId_serialNumber_key" ON "Battery"("clientId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Battery_clientId_batteryCode_key" ON "Battery"("clientId", "batteryCode");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_fleetId_installedAt_idx" ON "FleetBatteryHistory"("fleetId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_batteryId_installedAt_idx" ON "FleetBatteryHistory"("batteryId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetBatteryHistory_fleetId_batterySlot_removedAt_idx" ON "FleetBatteryHistory"("fleetId", "batterySlot", "removedAt");

-- CreateIndex
CREATE INDEX "Controller_clientId_status_idx" ON "Controller"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Controller_clientId_controllerNumber_key" ON "Controller"("clientId", "controllerNumber");

-- CreateIndex
CREATE INDEX "FleetControllerHistory_fleetId_installedAt_idx" ON "FleetControllerHistory"("fleetId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetControllerHistory_controllerId_installedAt_idx" ON "FleetControllerHistory"("controllerId", "installedAt");

-- CreateIndex
CREATE INDEX "FleetStatusHistory_fleetId_createdAt_idx" ON "FleetStatusHistory"("fleetId", "createdAt");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_fleetId_idx" ON "FleetTransfer"("clientId", "fleetId");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_fromHubId_idx" ON "FleetTransfer"("clientId", "fromHubId");

-- CreateIndex
CREATE INDEX "FleetTransfer_clientId_toHubId_idx" ON "FleetTransfer"("clientId", "toHubId");

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
CREATE UNIQUE INDEX "Rider_clientId_riderCode_key" ON "Rider"("clientId", "riderCode");

-- CreateIndex
CREATE UNIQUE INDEX "RiderOnboardingProgress_userId_key" ON "RiderOnboardingProgress"("userId");

-- CreateIndex
CREATE INDEX "RiderOnboardingProgress_clientId_packageId_idx" ON "RiderOnboardingProgress"("clientId", "packageId");

-- CreateIndex
CREATE INDEX "UserHub_clientId_hubId_idx" ON "UserHub"("clientId", "hubId");

-- CreateIndex
CREATE INDEX "UserHub_clientId_userId_idx" ON "UserHub"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserHub_userId_hubId_key" ON "UserHub"("userId", "hubId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderProfile_userId_key" ON "TeamLeaderProfile"("userId");

-- CreateIndex
CREATE INDEX "TeamLeaderProfile_clientId_deletedAt_idx" ON "TeamLeaderProfile"("clientId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderProfile_clientId_employeeCode_key" ON "TeamLeaderProfile"("clientId", "employeeCode");

-- CreateIndex
CREATE INDEX "TeamLeaderRider_clientId_teamLeaderId_isActive_idx" ON "TeamLeaderRider"("clientId", "teamLeaderId", "isActive");

-- CreateIndex
CREATE INDEX "TeamLeaderRider_clientId_riderId_isActive_idx" ON "TeamLeaderRider"("clientId", "riderId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TeamLeaderRider_teamLeaderId_riderId_key" ON "TeamLeaderRider"("teamLeaderId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOnboardingProgress_clientId_key" ON "ClientOnboardingProgress"("clientId");

-- CreateIndex
CREATE INDEX "ClientOnboardingStepRecord_clientId_step_status_idx" ON "ClientOnboardingStepRecord"("clientId", "step", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOnboardingStepRecord_progressId_step_key" ON "ClientOnboardingStepRecord"("progressId", "step");

-- CreateIndex
CREATE INDEX "ImportJob_clientId_entityType_createdAt_idx" ON "ImportJob"("clientId", "entityType", "createdAt");

-- CreateIndex
CREATE INDEX "Allocation_clientId_fleetId_status_idx" ON "Allocation"("clientId", "fleetId", "status");

-- CreateIndex
CREATE INDEX "Allocation_clientId_riderId_status_idx" ON "Allocation"("clientId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_clientId_idempotencyKey_key" ON "Allocation"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDeploymentWorkflow_allocationId_key" ON "MobileDeploymentWorkflow"("allocationId");

-- CreateIndex
CREATE INDEX "MobileDeploymentWorkflow_clientId_status_idx" ON "MobileDeploymentWorkflow"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentPayment_workflowId_key" ON "DeploymentPayment"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentPayment_providerReference_key" ON "DeploymentPayment"("providerReference");

-- CreateIndex
CREATE INDEX "DeploymentPayment_clientId_status_idx" ON "DeploymentPayment"("clientId", "status");

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
CREATE UNIQUE INDEX "RiderOnboardingDocument_photoId_key" ON "RiderOnboardingDocument"("photoId");

-- CreateIndex
CREATE INDEX "RiderOnboardingDocument_clientId_userId_fieldCode_status_idx" ON "RiderOnboardingDocument"("clientId", "userId", "fieldCode", "status");

-- CreateIndex
CREATE INDEX "RiderOnboardingDocument_clientId_riderId_status_idx" ON "RiderOnboardingDocument"("clientId", "riderId", "status");

-- CreateIndex
CREATE INDEX "RiderOnboardingDocument_clientId_status_createdAt_idx" ON "RiderOnboardingDocument"("clientId", "status", "createdAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "ClientDomain_hostname_key" ON "ClientDomain"("hostname");

-- CreateIndex
CREATE INDEX "ClientDomain_clientId_idx" ON "ClientDomain"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBranding_clientId_key" ON "ClientBranding"("clientId");

-- AddForeignKey
ALTER TABLE "VehicleType" ADD CONSTRAINT "VehicleType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_featureStepId_fkey" FOREIGN KEY ("featureStepId") REFERENCES "FeatureStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureStep" ADD CONSTRAINT "FeatureStep_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FeatureStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturePricing" ADD CONSTRAINT "FeaturePricing_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageVehicleTierPricing" ADD CONSTRAINT "PackageVehicleTierPricing_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureAddOn" ADD CONSTRAINT "FeatureAddOn_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingContent" ADD CONSTRAINT "TrainingContent_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeatureAddOn" ADD CONSTRAINT "PackageFeatureAddOn_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeatureAddOn" ADD CONSTRAINT "PackageFeatureAddOn_featureAddOnId_fkey" FOREIGN KEY ("featureAddOnId") REFERENCES "FeatureAddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBusinessProfile" ADD CONSTRAINT "ClientBusinessProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsProfile" ADD CONSTRAINT "ClientOperationsProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsVehicleCategory" ADD CONSTRAINT "ClientOperationsVehicleCategory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsVehicleCategory" ADD CONSTRAINT "ClientOperationsVehicleCategory_operationsProfileId_fkey" FOREIGN KEY ("operationsProfileId") REFERENCES "ClientOperationsProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOperationsVehicleCategory" ADD CONSTRAINT "ClientOperationsVehicleCategory_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "ClientPricingAdjustment" ADD CONSTRAINT "ClientPricingAdjustment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPricingAdjustment" ADD CONSTRAINT "ClientPricingAdjustment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_featureAddOnId_fkey" FOREIGN KEY ("featureAddOnId") REFERENCES "FeatureAddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFeatureAddOnPurchase" ADD CONSTRAINT "ClientFeatureAddOnPurchase_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCreditLot" ADD CONSTRAINT "FeatureCreditLot_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "ClientFeatureAddOnPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageLedger" ADD CONSTRAINT "FeatureUsageLedger_creditLotId_fkey" FOREIGN KEY ("creditLotId") REFERENCES "FeatureCreditLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_parentHubId_fkey" FOREIGN KEY ("parentHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_oemId_fkey" FOREIGN KEY ("oemId") REFERENCES "Oem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_homeHubId_fkey" FOREIGN KEY ("homeHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_currentHubId_fkey" FOREIGN KEY ("currentHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_iotDeviceId_fkey" FOREIGN KEY ("iotDeviceId") REFERENCES "IoTDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetRegistration" ADD CONSTRAINT "FleetRegistration_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetInsurance" ADD CONSTRAINT "FleetInsurance_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetFitness" ADD CONSTRAINT "FleetFitness_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetDocument" ADD CONSTRAINT "FleetDocument_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IoTDevice" ADD CONSTRAINT "IoTDevice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCurrentState" ADD CONSTRAINT "VehicleCurrentState_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCurrentState" ADD CONSTRAINT "VehicleCurrentState_iotDeviceId_fkey" FOREIGN KEY ("iotDeviceId") REFERENCES "IoTDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetBatteryHistory" ADD CONSTRAINT "FleetBatteryHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetBatteryHistory" ADD CONSTRAINT "FleetBatteryHistory_batteryId_fkey" FOREIGN KEY ("batteryId") REFERENCES "Battery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Controller" ADD CONSTRAINT "Controller_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetControllerHistory" ADD CONSTRAINT "FleetControllerHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetControllerHistory" ADD CONSTRAINT "FleetControllerHistory_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetStatusHistory" ADD CONSTRAINT "FleetStatusHistory_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_fromHubId_fkey" FOREIGN KEY ("fromHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetTransfer" ADD CONSTRAINT "FleetTransfer_toHubId_fkey" FOREIGN KEY ("toHubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingProgress" ADD CONSTRAINT "RiderOnboardingProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingProgress" ADD CONSTRAINT "RiderOnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderProfile" ADD CONSTRAINT "TeamLeaderProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderProfile" ADD CONSTRAINT "TeamLeaderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_teamLeaderId_fkey" FOREIGN KEY ("teamLeaderId") REFERENCES "TeamLeaderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamLeaderRider" ADD CONSTRAINT "TeamLeaderRider_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingProgress" ADD CONSTRAINT "ClientOnboardingProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingStepRecord" ADD CONSTRAINT "ClientOnboardingStepRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboardingStepRecord" ADD CONSTRAINT "ClientOnboardingStepRecord_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "ClientOnboardingProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeploymentWorkflow" ADD CONSTRAINT "MobileDeploymentWorkflow_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentPayment" ADD CONSTRAINT "DeploymentPayment_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "MobileDeploymentWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderKyc" ADD CONSTRAINT "RiderKyc_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderOnboardingDocument" ADD CONSTRAINT "RiderOnboardingDocument_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDomain" ADD CONSTRAINT "ClientDomain_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBranding" ADD CONSTRAINT "ClientBranding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
